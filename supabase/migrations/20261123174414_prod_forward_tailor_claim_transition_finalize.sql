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
-- Development-only PR 2, Stage 3 migration 2/5.
-- Finalize is a recoverable two-phase operation: the database locks and
-- snapshots readiness, Edge promotes private objects, then the database
-- verifies the promoted manifest and publishes atomically.

create table public.tailor_claim_finalize_receipts (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.tailor_claim_invites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 180),
  outcome text not null default 'IN_PROGRESS' check (outcome in ('IN_PROGRESS','SUCCEEDED','FAILED')),
  source_manifest jsonb not null,
  response_payload jsonb,
  failure_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (invite_id),
  unique (user_id,idempotency_key),
  check ((outcome='IN_PROGRESS')=(completed_at is null))
);
alter table public.tailor_claim_finalize_receipts enable row level security;
revoke all on public.tailor_claim_finalize_receipts from public,anon,authenticated;
grant all on public.tailor_claim_finalize_receipts to service_role;

create or replace function public.prepare_tailor_profile_finalize(
  p_user_id uuid,
  p_idempotency_key text
) returns table(result text,receipt_id uuid,profile_id text,source_manifest jsonb,response jsonb)
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_auth auth.users%rowtype;
  v_receipt public.tailor_claim_finalize_receipts%rowtype;
  v_expected_ids uuid[];
  v_consented_ids uuid[];
  v_currency_min integer;
  v_currency_max integer;
begin
  if p_user_id is null or char_length(trim(coalesce(p_idempotency_key,''))) not between 16 and 180 then
    result:='INVALID_FINALIZE'; return next; return;
  end if;
  select * into v_invite from public.tailor_claim_invites
    where tailor_user_id=p_user_id and status in ('CLAIMED_AWAITING_EMAIL','FINALIZING','LIVE') for update;
  if not found then result:='UNAVAILABLE'; return next; return; end if;
  select * into v_profile from public.tailor_profiles where id::text=v_invite.tailor_profile_id::text for update;
  select * into v_auth from auth.users where id=p_user_id for update;
  select * into v_receipt from public.tailor_claim_finalize_receipts where invite_id=v_invite.id for update;
  if found then
    if v_receipt.user_id<>p_user_id or v_receipt.idempotency_key<>trim(p_idempotency_key) then
      result:='FINALIZE_IN_PROGRESS'; return next; return;
    end if;
    result:=case v_receipt.outcome when 'SUCCEEDED' then 'LIVE' else 'PREPARED' end;
    receipt_id:=v_receipt.id; profile_id:=v_invite.tailor_profile_id::text;
    source_manifest:=v_receipt.source_manifest; response:=v_receipt.response_payload; return next; return;
  end if;
  v_currency_min:=case v_profile.currency when 'NGN' then 500000 when 'GHS' then 5000 when 'KES' then 50000 else 1000 end;
  v_currency_max:=case v_profile.currency when 'NGN' then 999999900 when 'GHS' then 100000000 when 'KES' then 500000000 when 'USD' then 10000000 when 'GBP' then 10000000 when 'EUR' then 10000000 when 'CAD' then 10000000 else null end;
  if v_invite.status<>'CLAIMED_AWAITING_EMAIL' or v_profile.lifecycle_state<>'CLAIMED_AWAITING_EMAIL'
     or v_auth.email_confirmed_at is null
     or not exists(select 1 from public.users u where u.id=p_user_id and u.phone_verified_at is not null)
     or v_invite.approved_at is null or v_invite.approved_by_principal is null
     or v_invite.marketplace_placement is null or not v_invite.public_evidence_reviewed
     or not v_invite.video_waiver_acknowledged or v_invite.consent_recorded_at is null
     or v_invite.consent_text_version is null or jsonb_typeof(v_invite.consent_media_manifest)<>'array'
     or length(trim(v_profile.display_name))<2 or length(trim(v_profile.location))<1
     or length(trim(coalesce(v_profile.bio,'')))<80
     or coalesce(cardinality(v_profile.languages),0) not between 1 and 12
     or coalesce(cardinality(v_profile.specialty_tags),0) not between 1 and 20
     or v_currency_max is null or v_profile.price_range_min is null or v_profile.price_range_max is null
     or v_profile.price_range_min<v_currency_min or v_profile.price_range_max<v_profile.price_range_min
     or v_profile.price_range_max>v_currency_max then
    result:='NOT_READY'; return next; return;
  end if;
  select coalesce(array_agg(m.id order by m.id::text),'{}'::uuid[]) into v_expected_ids
    from public.tailor_draft_media m where m.invite_id=v_invite.id
      and m.confirmed_at is not null and m.moderation_status='APPROVED';
  begin
    select coalesce(array_agg((value#>>'{}')::uuid order by value#>>'{}'),'{}'::uuid[])
      into v_consented_ids from jsonb_array_elements(v_invite.consent_media_manifest);
  exception when invalid_text_representation then result:='CONSENT_MANIFEST_INVALID'; return next; return;
  end;
  if v_expected_ids is distinct from v_consented_ids
     or not exists(select 1 from public.tailor_draft_media where invite_id=v_invite.id and media_kind='AVATAR' and id=any(v_expected_ids))
     or not exists(select 1 from public.tailor_draft_media where invite_id=v_invite.id and media_kind='PHOTO' and id=any(v_expected_ids)) then
    result:='CONSENT_MANIFEST_STALE'; return next; return;
  end if;
  source_manifest:=(select jsonb_agg(jsonb_build_object(
    'id',m.id,'storagePath',m.storage_path,'kind',m.media_kind,'contentType',m.content_type,
    'byteSize',m.byte_size,'sha256',m.sha256,'width',m.width,'height',m.height,
    'durationMs',m.duration_ms,'sortOrder',m.sort_order,'isCover',m.is_cover,
    'focalX',m.focal_x,'focalY',m.focal_y
  ) order by m.sort_order,m.created_at) from public.tailor_draft_media m where m.id=any(v_expected_ids));
  insert into public.tailor_claim_finalize_receipts(invite_id,user_id,idempotency_key,source_manifest)
    values(v_invite.id,p_user_id,trim(p_idempotency_key),source_manifest) returning id into receipt_id;
  update public.tailor_claim_invites set status='FINALIZING',updated_at=now() where id=v_invite.id;
  update public.tailor_profiles set lifecycle_state='FINALIZING',updated_at=now() where id::text=v_invite.tailor_profile_id::text;
  result:='PREPARED'; profile_id:=v_invite.tailor_profile_id::text; return next;
end;
$$;

create or replace function public.complete_tailor_profile_finalize(
  p_receipt_id uuid,
  p_user_id uuid,
  p_promoted_manifest jsonb
) returns jsonb
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_receipt public.tailor_claim_finalize_receipts%rowtype;
  v_invite public.tailor_claim_invites%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_source_ids uuid[];
  v_promoted_ids uuid[];
  v_avatar_url text;
  v_photo_urls text[];
  v_video_urls text[];
  v_response jsonb;
  v_auth auth.users%rowtype;
begin
  if jsonb_typeof(p_promoted_manifest)<>'array' then raise exception 'PROMOTED_MANIFEST_INVALID' using errcode='22023'; end if;
  select * into v_receipt from public.tailor_claim_finalize_receipts where id=p_receipt_id and user_id=p_user_id for update;
  if not found then raise exception 'FINALIZE_RECEIPT_MISSING' using errcode='22023'; end if;
  if v_receipt.outcome='SUCCEEDED' then return v_receipt.response_payload; end if;
  select * into v_invite from public.tailor_claim_invites where id=v_receipt.invite_id for update;
  select * into v_profile from public.tailor_profiles where id::text=v_invite.tailor_profile_id::text for update;
  select * into v_auth from auth.users where id=p_user_id for update;
  if v_invite.status<>'FINALIZING' or v_profile.lifecycle_state<>'FINALIZING' then raise exception 'FINALIZE_STATE_CHANGED' using errcode='40001'; end if;
  if v_auth.email_confirmed_at is null
     or not exists(select 1 from public.users u where u.id=p_user_id and u.phone_verified_at is not null)
     or v_invite.approved_at is null or v_invite.approved_by_principal is null
     or v_invite.marketplace_placement is null or not v_invite.public_evidence_reviewed
     or not v_invite.video_waiver_acknowledged or v_invite.consent_recorded_at is null then
    raise exception 'FINALIZE_READINESS_CHANGED' using errcode='40001';
  end if;
  select array_agg((value->>'id')::uuid order by value->>'id') into v_source_ids from jsonb_array_elements(v_receipt.source_manifest);
  select array_agg((value->>'draftMediaId')::uuid order by value->>'draftMediaId') into v_promoted_ids from jsonb_array_elements(p_promoted_manifest);
  if v_source_ids is distinct from v_promoted_ids then raise exception 'PROMOTED_MANIFEST_STALE' using errcode='22023'; end if;
  if exists(select 1 from unnest(v_source_ids) as source(source_id) left join public.tailor_draft_media m on m.id=source.source_id
    where m.id is null or m.invite_id<>v_invite.id or m.confirmed_at is null or m.moderation_status<>'APPROVED') then
    raise exception 'FINALIZE_MEDIA_CHANGED' using errcode='40001';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_promoted_manifest) p
    left join public.media_assets a on a.id=(p->>'mediaAssetId')::uuid
    where a.id is null or a.owner_user_id<>p_user_id or a.tailor_profile_id::text<>v_profile.id::text
      or a.status<>'ACTIVE' or a.moderation_status<>'APPROVED'
      or a.public_url is distinct from p->>'publicUrl'
  ) then raise exception 'PROMOTED_ASSET_INVALID' using errcode='22023'; end if;
  select max(p->>'publicUrl') filter(where s->>'kind'='AVATAR'),
    coalesce(array_agg(p->>'publicUrl' order by (s->>'sortOrder')::integer) filter(where s->>'kind'='PHOTO'),'{}'::text[]),
    coalesce(array_agg(p->>'publicUrl' order by (s->>'sortOrder')::integer) filter(where s->>'kind'='VIDEO'),'{}'::text[])
    into v_avatar_url,v_photo_urls,v_video_urls
  from jsonb_array_elements(v_receipt.source_manifest) s
  join jsonb_array_elements(p_promoted_manifest) p on p->>'draftMediaId'=s->>'id';
  if v_avatar_url is null or cardinality(v_photo_urls)<1 then raise exception 'PROMOTED_MEDIA_INCOMPLETE' using errcode='22023'; end if;
  perform set_config('drape.identity_verification_trusted_write','true',true);
  update public.tailor_profiles set avatar_url=v_avatar_url,portfolio_photo_urls=v_photo_urls,
    portfolio_video_urls=v_video_urls,id_verification_status='VERIFIED',id_verified_at=now(),
    id_verification_method='STAFF_PREAPPROVAL',
    id_verification_metadata=coalesce(id_verification_metadata,'{}'::jsonb)||jsonb_build_object(
      'verification_type','STAFF_PREAPPROVAL','approved_by_principal',v_invite.approved_by_principal,
      'approval_reason',v_invite.approval_reason,'evidence_ref',v_invite.evidence_ref,
      'public_evidence_reviewed',v_invite.public_evidence_reviewed,
      'challenge_video_waived',v_invite.video_waiver_acknowledged),
    is_verified=true,is_live=true,lifecycle_state='LIVE',updated_at=now()
    where id::text=v_profile.id::text;
  update public.tailor_claim_invites set status='LIVE',updated_at=now() where id=v_invite.id;
  update public.tailor_draft_media d set media_asset_id=(p->>'mediaAssetId')::uuid,updated_at=now()
    from jsonb_array_elements(p_promoted_manifest) p where d.id=(p->>'draftMediaId')::uuid;
  v_response:=jsonb_build_object('finalized',true,'receiptId',v_receipt.id,'profileId',v_profile.id::text,'state','LIVE','next','ADD_PAYOUTS');
  update public.tailor_claim_finalize_receipts set outcome='SUCCEEDED',response_payload=v_response,completed_at=now() where id=v_receipt.id;
  insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
    p_user_id::text,'TAILOR','tailor_claim.finalized','info',jsonb_build_object(
      'invite_id',v_invite.id,'profile_id',v_profile.id::text,'receipt_id',v_receipt.id,
      'media_count',jsonb_array_length(p_promoted_manifest),'preapproval_applied',true));
  return v_response;
end;
$$;

revoke all on function public.prepare_tailor_profile_finalize(uuid,text) from public,anon,authenticated;
revoke all on function public.complete_tailor_profile_finalize(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_tailor_profile_finalize(uuid,text) to service_role;
grant execute on function public.complete_tailor_profile_finalize(uuid,uuid,jsonb) to service_role;
-- Development-only PR 2, Stage 3 migration 3/5.
-- The receipt tables are service-only, but every RLS-enabled public table must
-- also carry the STAFF_DRAFT restrictive boundary as defense in depth.

drop policy if exists deny_staff_draft_claim_session on public.tailor_claim_transition_receipts;
create policy deny_staff_draft_claim_session
on public.tailor_claim_transition_receipts
as restrictive for all to authenticated
using (not public.is_staff_draft_identity())
with check (not public.is_staff_draft_identity());

drop policy if exists deny_staff_draft_claim_session on public.tailor_claim_finalize_receipts;
create policy deny_staff_draft_claim_session
on public.tailor_claim_finalize_receipts
as restrictive for all to authenticated
using (not public.is_staff_draft_identity())
with check (not public.is_staff_draft_identity());

create index if not exists tailor_claim_transition_receipts_bootstrap_session_idx
  on public.tailor_claim_transition_receipts(bootstrap_session_id);
-- Development-only PR 2, Stage 3 migration 4/5.
-- Recover abandoned CLAIMING transitions and permit a failed receipt to be
-- replaced only after its failure is preserved in the audit log.

alter function public.prepare_tailor_profile_claim(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)
  rename to prepare_tailor_profile_claim_v1;

revoke all on function public.prepare_tailor_profile_claim_v1(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)
  from public,anon,authenticated,service_role;

create function public.prepare_tailor_profile_claim(
  p_token_hash text,p_bootstrap_session_id uuid,p_user_id uuid,p_auth_session_id uuid,
  p_idempotency_key text,p_email text,p_email_hash text,p_phone text,p_pickup_address text,
  p_pickup_address_line1 text,p_pickup_city text,p_pickup_region text,p_pickup_postal_code text,
  p_pickup_country_code text,p_consent_text_version text,p_consent_media_manifest jsonb
) returns table(result text,receipt_id uuid,invite_id uuid,user_id uuid,response jsonb)
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_invite_id uuid; v_failed public.tailor_claim_transition_receipts%rowtype;
begin
  select i.id into v_invite_id from public.tailor_claim_invites i
  join public.tailor_claim_bootstrap_sessions b on b.invite_id=i.id
  where b.id=p_bootstrap_session_id and b.user_id=p_user_id and b.auth_session_id=p_auth_session_id
    and b.status='ACTIVE' and b.expires_at>now() and i.token_hash=p_token_hash
    and i.status in ('INVITED','OPENED') for update of i,b;
  if v_invite_id is not null then
    select * into v_failed from public.tailor_claim_transition_receipts
      where public.tailor_claim_transition_receipts.invite_id=v_invite_id and outcome='FAILED' for update;
    if found then
      insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
        p_user_id::text,'TAILOR','tailor_claim.failed_receipt_replaced','info',
        jsonb_build_object('invite_id',v_invite_id,'receipt_id',v_failed.id,
          'failure_code',v_failed.failure_code,'replacement_idempotency_key',trim(p_idempotency_key)));
      delete from public.tailor_claim_transition_receipts where id=v_failed.id;
    end if;
  end if;
  return query select * from public.prepare_tailor_profile_claim_v1(
    p_token_hash,p_bootstrap_session_id,p_user_id,p_auth_session_id,p_idempotency_key,
    p_email,p_email_hash,p_phone,p_pickup_address,p_pickup_address_line1,p_pickup_city,
    p_pickup_region,p_pickup_postal_code,p_pickup_country_code,p_consent_text_version,
    p_consent_media_manifest);
end;
$$;
revoke all on function public.prepare_tailor_profile_claim(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_tailor_profile_claim(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.fail_tailor_profile_claim_conflict(p_receipt_id uuid,p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_receipt public.tailor_claim_transition_receipts%rowtype;
begin
  select * into v_receipt from public.tailor_claim_transition_receipts
    where id=p_receipt_id and user_id=p_user_id and outcome='IN_PROGRESS' for update;
  if not found then return false; end if;
  update public.tailor_claim_transition_receipts set outcome='FAILED',failure_code='ACCOUNT_CONFLICT',completed_at=now() where id=v_receipt.id;
  update public.tailor_claim_invites set status='OPENED',updated_at=now() where id=v_receipt.invite_id and status='CLAIMING';
  update public.tailor_profiles p set lifecycle_state='OPENED',updated_at=now()
    from public.tailor_claim_invites i where i.id=v_receipt.invite_id and p.id::text=i.tailor_profile_id::text and p.lifecycle_state='CLAIMING';
  update public.tailor_claim_bootstrap_sessions set status='FAILED',completed_at=now(),updated_at=now()
    where id=v_receipt.bootstrap_session_id and status='ACTIVE';
  update auth.users set banned_until=greatest(coalesce(banned_until,'-infinity'::timestamptz),now()+interval '100 years'),
    raw_app_meta_data=(coalesce(raw_app_meta_data,'{}'::jsonb)-'claim_session_id')||jsonb_build_object('role','TAILOR','account_origin','STAFF_DRAFT')
    where id=p_user_id;
  delete from auth.sessions where user_id=p_user_id;
  insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
    p_user_id::text,'TAILOR','tailor_claim.account_conflict','warning',
    jsonb_build_object('invite_id',v_receipt.invite_id,'receipt_id',v_receipt.id,
      'bootstrap_session_id',v_receipt.bootstrap_session_id,'relocked',true));
  return true;
end;
$$;
revoke all on function public.fail_tailor_profile_claim_conflict(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fail_tailor_profile_claim_conflict(uuid,uuid) to service_role;

create or replace function public.reap_expired_tailor_claim_bootstrap_sessions(p_limit integer default 25)
returns table(bootstrap_session_id uuid,invite_id uuid,user_id uuid,auth_sessions_revoked integer)
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_row record; v_revoked integer; v_receipt public.tailor_claim_transition_receipts%rowtype;
begin
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'INVALID_REAPER_LIMIT' using errcode='22023'; end if;
  for v_row in
    select s.id,s.invite_id,s.user_id,i.status as invite_status,i.tailor_profile_id
    from public.tailor_claim_bootstrap_sessions s join public.tailor_claim_invites i on i.id=s.invite_id
    where s.status in ('PREPARING','ACTIVE') and s.expires_at<=now()
      and i.status in ('DRAFT','INVITED','OPENED','CLAIMING')
    order by s.expires_at,s.id for update of s,i skip locked limit p_limit
  loop
    update auth.users set banned_until=greatest(coalesce(banned_until,'-infinity'::timestamptz),now()+interval '100 years'),
      raw_app_meta_data=(coalesce(raw_app_meta_data,'{}'::jsonb)-'claim_session_id')||jsonb_build_object('role','TAILOR','account_origin','STAFF_DRAFT')
      where id=v_row.user_id;
    if not found then raise exception 'BOOTSTRAP_PLACEHOLDER_NOT_FOUND'; end if;
    delete from auth.sessions where auth.sessions.user_id=v_row.user_id; get diagnostics v_revoked=row_count;
    update public.tailor_claim_bootstrap_sessions set status='EXPIRED',activated_at=null,completed_at=now(),updated_at=now() where id=v_row.id;
    if v_row.invite_status='CLAIMING' then
      select * into v_receipt from public.tailor_claim_transition_receipts
        where public.tailor_claim_transition_receipts.invite_id=v_row.invite_id
          and public.tailor_claim_transition_receipts.bootstrap_session_id=v_row.id
          and public.tailor_claim_transition_receipts.outcome='IN_PROGRESS' for update;
      if found then
        update public.tailor_claim_transition_receipts set outcome='FAILED',failure_code='BOOTSTRAP_EXPIRED',completed_at=now() where id=v_receipt.id;
        update public.tailor_claim_invites set status='OPENED',updated_at=now() where id=v_row.invite_id and status='CLAIMING';
        update public.tailor_profiles set lifecycle_state='OPENED',updated_at=now()
          where id::text=v_row.tailor_profile_id::text and lifecycle_state='CLAIMING';
        insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
          v_row.user_id::text,'SYSTEM','tailor_claim.interrupted_claim_recovered','warning',
          jsonb_build_object('invite_id',v_row.invite_id,'receipt_id',v_receipt.id,
            'bootstrap_session_id',v_row.id,'failure_code','BOOTSTRAP_EXPIRED'));
      end if;
    end if;
    bootstrap_session_id:=v_row.id; invite_id:=v_row.invite_id; user_id:=v_row.user_id; auth_sessions_revoked:=v_revoked; return next;
  end loop;
end;
$$;
revoke all on function public.reap_expired_tailor_claim_bootstrap_sessions(integer) from public,anon,authenticated;
grant execute on function public.reap_expired_tailor_claim_bootstrap_sessions(integer) to service_role;
-- Development-only PR 2, Stage 3 migration 5/5.
-- Once Auth owns the tailor's real credentials, expiry must never restore the
-- placeholder lock. Keep the transition replayable until database completion.

alter table public.tailor_claim_transition_receipts
  add column auth_handover_at timestamptz;

create or replace function public.record_tailor_profile_claim_auth_handover(
  p_receipt_id uuid,
  p_user_id uuid
) returns boolean
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_receipt public.tailor_claim_transition_receipts%rowtype;
  v_auth_user auth.users%rowtype;
begin
  select * into v_receipt
  from public.tailor_claim_transition_receipts
  where id=p_receipt_id and user_id=p_user_id and outcome='IN_PROGRESS'
  for update;
  if not found then return false; end if;

  select * into v_auth_user from auth.users where id=p_user_id for update;
  if not found
     or lower(coalesce(v_auth_user.email,''))<>lower(coalesce(v_receipt.request_payload->>'email',''))
     or coalesce(v_auth_user.raw_app_meta_data->>'account_origin','')<>'CLAIMED'
     or v_auth_user.raw_app_meta_data ? 'claim_session_id'
     or (v_auth_user.banned_until is not null and v_auth_user.banned_until>now()) then
    return false;
  end if;

  update public.tailor_claim_transition_receipts
  set auth_handover_at=coalesce(auth_handover_at,now())
  where id=v_receipt.id;
  return true;
end;
$$;

revoke all on function public.record_tailor_profile_claim_auth_handover(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.record_tailor_profile_claim_auth_handover(uuid,uuid)
  to service_role;

create or replace function public.reap_expired_tailor_claim_bootstrap_sessions(p_limit integer default 25)
returns table(bootstrap_session_id uuid,invite_id uuid,user_id uuid,auth_sessions_revoked integer)
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_row record;
  v_revoked integer;
  v_receipt public.tailor_claim_transition_receipts%rowtype;
  v_auth_handed_over boolean;
begin
  if p_limit is null or p_limit<1 or p_limit>50 then
    raise exception 'INVALID_REAPER_LIMIT' using errcode='22023';
  end if;

  for v_row in
    select s.id,s.invite_id,s.user_id,i.status as invite_status,i.tailor_profile_id
    from public.tailor_claim_bootstrap_sessions s
    join public.tailor_claim_invites i on i.id=s.invite_id
    where s.status in ('PREPARING','ACTIVE') and s.expires_at<=now()
      and i.status in ('DRAFT','INVITED','OPENED','CLAIMING')
    order by s.expires_at,s.id for update of s,i skip locked limit p_limit
  loop
    v_revoked:=0;
    v_auth_handed_over:=false;
    v_receipt:=null;

    if v_row.invite_status='CLAIMING' then
      select * into v_receipt
      from public.tailor_claim_transition_receipts r
      where r.invite_id=v_row.invite_id
        and r.bootstrap_session_id=v_row.id
        and r.outcome='IN_PROGRESS'
      for update;

      if found then
        v_auth_handed_over:=v_receipt.auth_handover_at is not null or exists(
          select 1 from auth.users u
          where u.id=v_row.user_id
            and lower(coalesce(u.email,''))=lower(coalesce(v_receipt.request_payload->>'email',''))
            and coalesce(u.raw_app_meta_data->>'account_origin','')='CLAIMED'
            and not (u.raw_app_meta_data ? 'claim_session_id')
            and (u.banned_until is null or u.banned_until<=now())
        );
      end if;
    end if;

    update public.tailor_claim_bootstrap_sessions
    set status='EXPIRED',activated_at=null,completed_at=now(),updated_at=now()
    where id=v_row.id;

    if v_auth_handed_over then
      update public.tailor_claim_transition_receipts
      set auth_handover_at=coalesce(auth_handover_at,now())
      where id=v_receipt.id;
      insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
        v_row.user_id::text,'SYSTEM','tailor_claim.handover_awaiting_replay','warning',
        jsonb_build_object('invite_id',v_row.invite_id,'receipt_id',v_receipt.id,
          'bootstrap_session_id',v_row.id));
    else
      update auth.users
      set banned_until=greatest(coalesce(banned_until,'-infinity'::timestamptz),now()+interval '100 years'),
        raw_app_meta_data=(coalesce(raw_app_meta_data,'{}'::jsonb)-'claim_session_id')
          ||jsonb_build_object('role','TAILOR','account_origin','STAFF_DRAFT')
      where id=v_row.user_id;
      if not found then raise exception 'BOOTSTRAP_PLACEHOLDER_NOT_FOUND'; end if;

      delete from auth.sessions where auth.sessions.user_id=v_row.user_id;
      get diagnostics v_revoked=row_count;

      if v_row.invite_status='CLAIMING' and v_receipt.id is not null then
        update public.tailor_claim_transition_receipts
        set outcome='FAILED',failure_code='BOOTSTRAP_EXPIRED',completed_at=now()
        where id=v_receipt.id;
        update public.tailor_claim_invites set status='OPENED',updated_at=now()
        where id=v_row.invite_id and status='CLAIMING';
        update public.tailor_profiles set lifecycle_state='OPENED',updated_at=now()
        where id::text=v_row.tailor_profile_id::text and lifecycle_state='CLAIMING';
        insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
          v_row.user_id::text,'SYSTEM','tailor_claim.interrupted_claim_recovered','warning',
          jsonb_build_object('invite_id',v_row.invite_id,'receipt_id',v_receipt.id,
            'bootstrap_session_id',v_row.id,'failure_code','BOOTSTRAP_EXPIRED'));
      end if;
    end if;

    bootstrap_session_id:=v_row.id;
    invite_id:=v_row.invite_id;
    user_id:=v_row.user_id;
    auth_sessions_revoked:=v_revoked;
    return next;
  end loop;
end;
$$;

revoke all on function public.reap_expired_tailor_claim_bootstrap_sessions(integer)
  from public,anon,authenticated;
grant execute on function public.reap_expired_tailor_claim_bootstrap_sessions(integer)
  to service_role;

comment on column public.tailor_claim_transition_receipts.auth_handover_at is
  'Set immediately after Auth receives the real credentials; expiry must preserve replay after this point.';
-- Development-only PR 2, Stage 4 migration 1/5.
-- Reject a duplicate phone before Auth handover. If a race still reaches the
-- write trigger after handover, permit a service-only replay with a corrected
-- phone while preserving the original transition receipt and idempotency key.

create or replace function public.prepare_tailor_profile_claim(
  p_token_hash text,p_bootstrap_session_id uuid,p_user_id uuid,p_auth_session_id uuid,
  p_idempotency_key text,p_email text,p_email_hash text,p_phone text,p_pickup_address text,
  p_pickup_address_line1 text,p_pickup_city text,p_pickup_region text,p_pickup_postal_code text,
  p_pickup_country_code text,p_consent_text_version text,p_consent_media_manifest jsonb
) returns table(result text,receipt_id uuid,invite_id uuid,user_id uuid,response jsonb)
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_invite_id uuid;
  v_failed public.tailor_claim_transition_receipts%rowtype;
  v_phone text;
begin
  v_phone:=public.normalize_account_phone_e164(p_phone);
  if v_phone is null or v_phone<>p_phone then
    result:='INVALID_PHONE'; return next; return;
  end if;
  if exists(
    select 1 from public.users u
    where u.id::text<>p_user_id::text
      and public.normalize_account_phone_e164(u.phone)=v_phone
    union all
    select 1 from public.customer_profiles c
    where c.user_id::text<>p_user_id::text
      and public.normalize_account_phone_e164(c.phone)=v_phone
  ) then
    result:='PHONE_ALREADY_IN_USE'; return next; return;
  end if;

  select i.id into v_invite_id from public.tailor_claim_invites i
  join public.tailor_claim_bootstrap_sessions b on b.invite_id=i.id
  where b.id=p_bootstrap_session_id and b.user_id=p_user_id and b.auth_session_id=p_auth_session_id
    and b.status='ACTIVE' and b.expires_at>now() and i.token_hash=p_token_hash
    and i.status in ('INVITED','OPENED') for update of i,b;
  if v_invite_id is not null then
    select * into v_failed from public.tailor_claim_transition_receipts
      where public.tailor_claim_transition_receipts.invite_id=v_invite_id and outcome='FAILED' for update;
    if found then
      insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
        p_user_id::text,'TAILOR','tailor_claim.failed_receipt_replaced','info',
        jsonb_build_object('invite_id',v_invite_id,'receipt_id',v_failed.id,
          'failure_code',v_failed.failure_code,'replacement_idempotency_key',trim(p_idempotency_key)));
      delete from public.tailor_claim_transition_receipts where id=v_failed.id;
    end if;
  end if;
  return query select * from public.prepare_tailor_profile_claim_v1(
    p_token_hash,p_bootstrap_session_id,p_user_id,p_auth_session_id,p_idempotency_key,
    p_email,p_email_hash,v_phone,p_pickup_address,p_pickup_address_line1,p_pickup_city,
    p_pickup_region,p_pickup_postal_code,p_pickup_country_code,p_consent_text_version,
    p_consent_media_manifest);
end;
$$;

revoke all on function public.prepare_tailor_profile_claim(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.prepare_tailor_profile_claim(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)
  to service_role;

create or replace function public.update_tailor_profile_claim_phone(
  p_receipt_id uuid,p_user_id uuid,p_phone text
) returns text
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_receipt public.tailor_claim_transition_receipts%rowtype;
  v_phone text;
begin
  v_phone:=public.normalize_account_phone_e164(p_phone);
  if v_phone is null or v_phone<>p_phone then return 'INVALID_PHONE'; end if;

  select * into v_receipt from public.tailor_claim_transition_receipts
  where id=p_receipt_id and user_id=p_user_id and outcome='IN_PROGRESS'
    and auth_handover_at is not null for update;
  if not found then return 'CLAIM_RECEIPT_MISSING'; end if;

  if exists(
    select 1 from public.users u
    where u.id::text<>p_user_id::text
      and public.normalize_account_phone_e164(u.phone)=v_phone
    union all
    select 1 from public.customer_profiles c
    where c.user_id::text<>p_user_id::text
      and public.normalize_account_phone_e164(c.phone)=v_phone
  ) then return 'PHONE_ALREADY_IN_USE'; end if;

  update public.tailor_claim_transition_receipts
  set request_payload=jsonb_set(request_payload,'{phone}',to_jsonb(v_phone),true)
  where id=v_receipt.id;
  insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
    p_user_id::text,'TAILOR','tailor_claim.phone_corrected_after_handover','warning',
    jsonb_build_object('invite_id',v_receipt.invite_id,'receipt_id',v_receipt.id));
  return 'PHONE_UPDATED';
end;
$$;

revoke all on function public.update_tailor_profile_claim_phone(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.update_tailor_profile_claim_phone(uuid,uuid,text)
  to service_role;

create or replace function public.rebind_tailor_claim_bootstrap_auth_session(
  p_bootstrap_session_id uuid,p_user_id uuid,p_old_auth_session_id uuid,p_new_auth_session_id uuid
) returns boolean
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_invite_id uuid;
begin
  update public.tailor_claim_bootstrap_sessions
  set auth_session_id=p_new_auth_session_id,updated_at=now()
  where id=p_bootstrap_session_id and user_id=p_user_id
    and auth_session_id=p_old_auth_session_id and status='ACTIVE' and expires_at>now()
  returning invite_id into v_invite_id;
  if v_invite_id is null then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
    p_user_id::text,'TAILOR','tailor_claim.auth_session_rebound','info',
    jsonb_build_object('invite_id',v_invite_id,'bootstrap_session_id',p_bootstrap_session_id));
  return true;
end;
$$;

revoke all on function public.rebind_tailor_claim_bootstrap_auth_session(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.rebind_tailor_claim_bootstrap_auth_session(uuid,uuid,uuid,uuid)
  to service_role;

create or replace function public.complete_tailor_profile_claim(
  p_receipt_id uuid,p_user_id uuid,p_email text
) returns jsonb
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_receipt public.tailor_claim_transition_receipts%rowtype;
  v_invite public.tailor_claim_invites%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_request jsonb;
  v_response jsonb;
  v_phone text;
begin
  select * into v_receipt from public.tailor_claim_transition_receipts
  where id=p_receipt_id and user_id=p_user_id for update;
  if not found then raise exception 'Claim receipt missing' using errcode='P1005',hint='CLAIM_RECEIPT_MISSING'; end if;
  if v_receipt.outcome='SUCCEEDED' then return v_receipt.response_payload; end if;
  if v_receipt.outcome<>'IN_PROGRESS' then raise exception 'Claim receipt failed' using errcode='P1004',hint='CLAIM_RECEIPT_FAILED'; end if;
  select * into v_invite from public.tailor_claim_invites where id=v_receipt.invite_id for update;
  select * into v_profile from public.tailor_profiles where id::text=v_invite.tailor_profile_id::text for update;
  if v_invite.status<>'CLAIMING' or v_profile.lifecycle_state<>'CLAIMING' then
    raise exception 'Claim state changed' using errcode='P1003',hint='CLAIM_STATE_CHANGED';
  end if;
  if p_email is null or p_email<>lower(trim(p_email)) or char_length(p_email)>320 then
    raise exception 'Claim email invalid' using errcode='P1006',hint='CLAIM_EMAIL_INVALID';
  end if;
  if exists(select 1 from public.users where email=p_email and id<>p_user_id) then
    raise exception 'Account conflict' using errcode='P1002',hint='ACCOUNT_CONFLICT';
  end if;
  v_request:=v_receipt.request_payload;
  v_phone:=public.normalize_account_phone_e164(v_request->>'phone');
  if v_phone is null then
    raise exception 'Claim phone invalid' using errcode='P1007',hint='INVALID_PHONE';
  end if;
  if exists(
    select 1 from public.users u where u.id::text<>p_user_id::text
      and public.normalize_account_phone_e164(u.phone)=v_phone
    union all
    select 1 from public.customer_profiles c where c.user_id::text<>p_user_id::text
      and public.normalize_account_phone_e164(c.phone)=v_phone
  ) then
    raise exception 'Phone already in use' using errcode='P1001',hint='PHONE_ALREADY_IN_USE';
  end if;

  update public.users set email=p_email,display_name=v_profile.display_name,role='TAILOR',
    phone=v_phone,phone_verified_at=null,updated_at=now() where id=p_user_id;
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
      'media_count',jsonb_array_length(v_request->'consentMediaManifest')));
  return v_response;
end;
$$;

revoke all on function public.complete_tailor_profile_claim(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.complete_tailor_profile_claim(uuid,uuid,text)
  to service_role;

comment on function public.update_tailor_profile_claim_phone(uuid,uuid,text) is
  'Service-only recovery for an Auth-handed-over claim whose requested phone collided before database completion.';
-- Keep claimed-but-not-finalized staff profiles out of the normal tailor app.
-- These profiles can satisfy legacy profile_completed checks before their
-- phone is verified and their private media is published.

drop function if exists public.get_my_tailor_profile_guard();

create function public.get_my_tailor_profile_guard()
returns table (
  id text,
  profile_completed boolean,
  display_name text,
  location text,
  id_verification_status text,
  avatar_url text,
  lifecycle_state text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    tp.id,
    tp.profile_completed,
    tp.display_name,
    tp.location,
    tp.id_verification_status,
    tp.avatar_url,
    tp.lifecycle_state::text
  from public.tailor_profiles as tp
  where tp.user_id::text = (select auth.uid())::text
  limit 1;
$$;

revoke all on function public.get_my_tailor_profile_guard() from public;
revoke all on function public.get_my_tailor_profile_guard() from anon;
grant execute on function public.get_my_tailor_profile_guard() to authenticated;
-- Development-only PR 2, Stage 4 migration 2/5.
-- The function was renamed to _v1 in Stage 3. Preserve its body and all
-- existing transition guards while changing only the postcode condition.
do $$
declare
  v_definition text;
  v_old text := 'or char_length(trim(coalesce(p_pickup_postal_code,''''))) not between 2 and 32';
  v_new text := 'or (char_length(trim(coalesce(p_pickup_postal_code,''''))) not between 2 and 32 and not (p_pickup_country_code in (''GH'',''NG'') and nullif(trim(coalesce(p_pickup_postal_code,'''')),'''') is null))';
begin
  select pg_get_functiondef('public.prepare_tailor_profile_claim_v1(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null or position(v_old in v_definition) = 0 then
    raise exception 'Unexpected prepare_tailor_profile_claim_v1 definition; aborting postcode migration';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;

-- Store a missing postcode as NULL, matching the rest of pickup and delivery
-- handling. Keep the receipt's original request intact for idempotent replay.
do $$
declare
  v_definition text;
  v_old text := 'v_request->>''pickupCity'',v_request->>''pickupRegion'',v_request->>''pickupPostalCode'',';
  v_new text := 'v_request->>''pickupCity'',v_request->>''pickupRegion'',nullif(trim(v_request->>''pickupPostalCode''),''''),';
begin
  select pg_get_functiondef('public.complete_tailor_profile_claim(uuid,uuid,text)'::regprocedure)
    into v_definition;
  if v_definition is null or position(v_old in v_definition) = 0 then
    raise exception 'Unexpected complete_tailor_profile_claim definition; aborting postcode migration';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;
-- Consuming a verified email code preserves when it was verified. The original
-- status/verified_at check allowed only VERIFIED, so prepare failed before it
-- could issue a claim transition receipt.
alter table public.tailor_claim_email_codes
  drop constraint tailor_claim_email_codes_check1;

alter table public.tailor_claim_email_codes
  add constraint tailor_claim_email_codes_verified_status_check
  check ((status in ('VERIFIED', 'CONSUMED')) = (verified_at is not null));

comment on constraint tailor_claim_email_codes_verified_status_check
  on public.tailor_claim_email_codes is
  'A verified timestamp persists when the one-time code is consumed.';
