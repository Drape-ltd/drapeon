-- Development-only PR 2, Stage 3 migration 1/5.
-- Durable, idempotent ownership handover. Auth Admin changes are orchestrated
-- by tailor-claim-action between prepare and complete.

alter table public.tailor_claim_email_codes drop constraint if exists tailor_claim_email_codes_status_check;
alter table public.tailor_claim_email_codes add constraint tailor_claim_email_codes_status_check
  check (status in ('PENDING','VERIFIED','CONSUMED','EXPIRED','SUPERSEDED','LOCKED'));

create table public.tailor_claim_transition_receipts (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.tailor_claim_invites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bootstrap_session_id uuid not null references public.tailor_claim_bootstrap_sessions(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 180),
  outcome text not null default 'IN_PROGRESS'
    check (outcome in ('IN_PROGRESS','SUCCEEDED','FAILED')),
  request_payload jsonb not null,
  response_payload jsonb,
  failure_code text check (failure_code is null or char_length(failure_code) <= 80),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (invite_id),
  unique (user_id, idempotency_key),
  check ((outcome = 'IN_PROGRESS') = (completed_at is null))
);

alter table public.tailor_claim_transition_receipts enable row level security;
revoke all on public.tailor_claim_transition_receipts from public, anon, authenticated;
grant select, insert, update, delete on public.tailor_claim_transition_receipts to service_role;

create or replace function public.prepare_tailor_profile_claim(
  p_token_hash text,
  p_bootstrap_session_id uuid,
  p_user_id uuid,
  p_auth_session_id uuid,
  p_idempotency_key text,
  p_email text,
  p_email_hash text,
  p_phone text,
  p_pickup_address text,
  p_pickup_address_line1 text,
  p_pickup_city text,
  p_pickup_region text,
  p_pickup_postal_code text,
  p_pickup_country_code text,
  p_consent_text_version text,
  p_consent_media_manifest jsonb
) returns table(result text, receipt_id uuid, invite_id uuid, user_id uuid, response jsonb)
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_bootstrap public.tailor_claim_bootstrap_sessions%rowtype;
  v_receipt public.tailor_claim_transition_receipts%rowtype;
  v_manifest_ids uuid[];
  v_expected_ids uuid[];
  v_email_code_id uuid;
begin
  if length(coalesce(p_token_hash,'')) <> 43
     or p_bootstrap_session_id is null or p_user_id is null or p_auth_session_id is null
     or char_length(trim(coalesce(p_idempotency_key,''))) not between 16 and 180
     or p_email is null or p_email<>lower(trim(p_email)) or char_length(p_email)>320
     or p_phone !~ '^\+[1-9][0-9]{7,14}$'
     or char_length(trim(coalesce(p_pickup_address,''))) not between 8 and 500
     or char_length(trim(coalesce(p_pickup_address_line1,''))) not between 3 and 200
     or char_length(trim(coalesce(p_pickup_city,''))) not between 2 and 120
     or char_length(trim(coalesce(p_pickup_region,''))) not between 2 and 120
     or char_length(trim(coalesce(p_pickup_postal_code,''))) not between 2 and 32
     or p_pickup_country_code !~ '^[A-Z]{2}$'
     or char_length(trim(coalesce(p_consent_text_version,''))) not between 3 and 80
     or jsonb_typeof(p_consent_media_manifest) <> 'array' then
    result := 'INVALID_CLAIM'; return next; return;
  end if;

  select b.* into v_bootstrap from public.tailor_claim_bootstrap_sessions b
  where b.id=p_bootstrap_session_id and b.user_id=p_user_id and b.auth_session_id=p_auth_session_id
    and b.status='ACTIVE' and b.expires_at>now() for update;
  if not found then result := 'CLAIM_SESSION_EXPIRED'; return next; return; end if;

  select i.* into v_invite from public.tailor_claim_invites i
  where i.id=v_bootstrap.invite_id and i.tailor_user_id=p_user_id and i.token_hash=p_token_hash for update;
  if not found or v_invite.status not in ('INVITED','OPENED')
     or v_invite.expires_at is null or v_invite.expires_at<=now() then
    result := 'UNAVAILABLE'; return next; return;
  end if;

  select * into v_receipt from public.tailor_claim_transition_receipts
  where public.tailor_claim_transition_receipts.invite_id=v_invite.id for update;
  if found then
    if v_receipt.user_id<>p_user_id or v_receipt.idempotency_key<>trim(p_idempotency_key) then
      result := 'CLAIM_IN_PROGRESS'; invite_id:=v_invite.id; return next; return;
    end if;
    result := case v_receipt.outcome when 'SUCCEEDED' then 'CLAIMED' when 'IN_PROGRESS' then 'PREPARED' else 'FAILED' end;
    receipt_id:=v_receipt.id; invite_id:=v_receipt.invite_id; user_id:=v_receipt.user_id;
    response:=v_receipt.response_payload; return next; return;
  end if;

  if exists(select 1 from auth.users where email=p_email and id<>p_user_id)
     or exists(select 1 from public.users where email=p_email and id<>p_user_id) then
    result:='ACCOUNT_CONFLICT'; invite_id:=v_invite.id; return next; return;
  end if;

  if v_bootstrap.provider is null then
    if length(coalesce(p_email_hash,''))<>43 then
      result:='EMAIL_VERIFICATION_REQUIRED'; invite_id:=v_invite.id; return next; return;
    end if;
    select c.id into v_email_code_id from public.tailor_claim_email_codes c
      where c.invite_id=v_invite.id and c.email_hash=p_email_hash and c.status='VERIFIED'
        and c.verified_at>now()-interval '15 minutes' order by c.verified_at desc limit 1 for update;
    if v_email_code_id is null then result:='EMAIL_VERIFICATION_REQUIRED'; invite_id:=v_invite.id; return next; return; end if;
  elsif v_bootstrap.provider_verified_at is null or v_bootstrap.provider_subject is null then
    result:='PROVIDER_VERIFICATION_REQUIRED'; invite_id:=v_invite.id; return next; return;
  end if;

  select coalesce(array_agg((value#>>'{}')::uuid order by value#>>'{}'),'{}'::uuid[])
    into v_manifest_ids from jsonb_array_elements(p_consent_media_manifest);
  if cardinality(v_manifest_ids) <> jsonb_array_length(p_consent_media_manifest) then
    result:='CONSENT_MANIFEST_INVALID'; invite_id:=v_invite.id; return next; return;
  end if;
  select coalesce(array_agg(m.id order by m.id::text),'{}'::uuid[]) into v_expected_ids
  from public.tailor_draft_media m where m.invite_id=v_invite.id
    and m.confirmed_at is not null and m.moderation_status='APPROVED';
  if v_manifest_ids is distinct from v_expected_ids or cardinality(v_expected_ids)<2 then
    result:='CONSENT_MANIFEST_STALE'; invite_id:=v_invite.id; return next; return;
  end if;

  insert into public.tailor_claim_transition_receipts(
    invite_id,user_id,bootstrap_session_id,idempotency_key,request_payload
  ) values (
    v_invite.id,p_user_id,p_bootstrap_session_id,trim(p_idempotency_key),
    jsonb_build_object(
      'phone',p_phone,'pickupAddress',trim(p_pickup_address),
      'pickupAddressLine1',trim(p_pickup_address_line1),'pickupCity',trim(p_pickup_city),
      'pickupRegion',trim(p_pickup_region),'pickupPostalCode',trim(p_pickup_postal_code),
      'pickupCountryCode',p_pickup_country_code,'consentTextVersion',trim(p_consent_text_version),
      'consentMediaManifest',p_consent_media_manifest,'email',p_email,'emailHash',p_email_hash
    )
  ) returning id into receipt_id;
  if v_email_code_id is not null then
    update public.tailor_claim_email_codes set status='CONSUMED',updated_at=now()
      where id=v_email_code_id and status='VERIFIED';
  end if;
  update public.tailor_claim_invites set status='CLAIMING',updated_at=now() where id=v_invite.id;
  update public.tailor_profiles set lifecycle_state='CLAIMING',updated_at=now()
    where id::text=v_invite.tailor_profile_id::text and lifecycle_state in ('INVITED','OPENED');
  result:='PREPARED'; invite_id:=v_invite.id; user_id:=p_user_id; return next;
exception when invalid_text_representation then
  result:='CONSENT_MANIFEST_INVALID'; return next;
end;
$$;

create or replace function public.complete_tailor_profile_claim(
  p_receipt_id uuid,
  p_user_id uuid,
  p_email text
) returns jsonb
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_receipt public.tailor_claim_transition_receipts%rowtype;
  v_invite public.tailor_claim_invites%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  select * into v_receipt from public.tailor_claim_transition_receipts
  where id=p_receipt_id and user_id=p_user_id for update;
  if not found then raise exception 'CLAIM_RECEIPT_MISSING' using errcode='22023'; end if;
  if v_receipt.outcome='SUCCEEDED' then return v_receipt.response_payload; end if;
  if v_receipt.outcome<>'IN_PROGRESS' then raise exception 'CLAIM_RECEIPT_FAILED' using errcode='55000'; end if;
  select * into v_invite from public.tailor_claim_invites where id=v_receipt.invite_id for update;
  select * into v_profile from public.tailor_profiles where id::text=v_invite.tailor_profile_id::text for update;
  if v_invite.status<>'CLAIMING' or v_profile.lifecycle_state<>'CLAIMING' then
    raise exception 'CLAIM_STATE_CHANGED' using errcode='40001';
  end if;
  if p_email is null or p_email<>lower(trim(p_email)) or char_length(p_email)>320 then
    raise exception 'CLAIM_EMAIL_INVALID' using errcode='22023';
  end if;
  if exists(select 1 from public.users where email=p_email and id<>p_user_id) then
    raise exception 'ACCOUNT_CONFLICT' using errcode='23505';
  end if;
  v_request:=v_receipt.request_payload;
  update public.users set email=p_email,display_name=v_profile.display_name,role='TAILOR',
    phone=v_request->>'phone',phone_verified_at=null,updated_at=now() where id=p_user_id;
  insert into public.tailor_pickup_details(
    user_id,pickup_address,pickup_address_line1,pickup_city,pickup_region,
    pickup_postal_code,pickup_country_code,updated_at
  ) values (
    p_user_id,v_request->>'pickupAddress',v_request->>'pickupAddressLine1',
    v_request->>'pickupCity',v_request->>'pickupRegion',v_request->>'pickupPostalCode',
    v_request->>'pickupCountryCode',now()
  ) on conflict(user_id) do update set
    pickup_address=excluded.pickup_address,pickup_address_line1=excluded.pickup_address_line1,
    pickup_city=excluded.pickup_city,pickup_region=excluded.pickup_region,
    pickup_postal_code=excluded.pickup_postal_code,pickup_country_code=excluded.pickup_country_code,
    pickup_location_verification_source=null,pickup_location_verification_reference=null,
    pickup_location_verified_at=null,updated_at=now();
  update public.tailor_claim_invites set status='CLAIMED_AWAITING_EMAIL',token_hash=null,
    claimed_at=coalesce(claimed_at,now()),consent_recorded_at=now(),
    consent_text_version=v_request->>'consentTextVersion',
    consent_media_manifest=v_request->'consentMediaManifest',updated_at=now() where id=v_invite.id;
  update public.tailor_profiles set lifecycle_state='CLAIMED_AWAITING_EMAIL',updated_at=now()
    where id::text=v_invite.tailor_profile_id::text;
  update public.tailor_claim_bootstrap_sessions set status='CONSUMED',activated_at=null,
    completed_at=now(),updated_at=now() where id=v_receipt.bootstrap_session_id and status='ACTIVE';
  v_response:=jsonb_build_object('claimed',true,'receiptId',v_receipt.id,
    'inviteId',v_invite.id,'profileId',v_invite.tailor_profile_id::text,
    'state','CLAIMED_AWAITING_EMAIL','next','VERIFY_PHONE');
  update public.tailor_claim_transition_receipts set outcome='SUCCEEDED',response_payload=v_response,
    completed_at=now() where id=v_receipt.id;
  insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
    p_user_id::text,'TAILOR','tailor_claim.claim_completed','info',
    jsonb_build_object('invite_id',v_invite.id,'profile_id',v_invite.tailor_profile_id::text,
      'receipt_id',v_receipt.id,'consent_text_version',v_request->>'consentTextVersion',
      'media_count',jsonb_array_length(v_request->'consentMediaManifest'))
  );
  return v_response;
end;
$$;

create or replace function public.fail_tailor_profile_claim_conflict(
  p_receipt_id uuid,
  p_user_id uuid
) returns boolean
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_receipt public.tailor_claim_transition_receipts%rowtype;
begin
  select * into v_receipt from public.tailor_claim_transition_receipts
    where id=p_receipt_id and user_id=p_user_id and outcome='IN_PROGRESS' for update;
  if not found then return false; end if;
  update public.tailor_claim_transition_receipts set outcome='FAILED',failure_code='ACCOUNT_CONFLICT',
    completed_at=now() where id=v_receipt.id;
  update public.tailor_claim_invites set status='OPENED',updated_at=now()
    where id=v_receipt.invite_id and status='CLAIMING';
  update public.tailor_profiles p set lifecycle_state='OPENED',updated_at=now()
    from public.tailor_claim_invites i where i.id=v_receipt.invite_id
      and p.id::text=i.tailor_profile_id::text and p.lifecycle_state='CLAIMING';
  insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
    p_user_id::text,'TAILOR','tailor_claim.account_conflict','warning',
    jsonb_build_object('invite_id',v_receipt.invite_id,'receipt_id',v_receipt.id));
  return true;
end;
$$;

revoke all on function public.prepare_tailor_profile_claim(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.complete_tailor_profile_claim(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.fail_tailor_profile_claim_conflict(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_tailor_profile_claim(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.complete_tailor_profile_claim(uuid,uuid,text) to service_role;
grant execute on function public.fail_tailor_profile_claim_conflict(uuid,uuid) to service_role;

comment on table public.tailor_claim_transition_receipts is
  'Service-only recoverable receipts spanning claim database and Auth Admin steps.';
