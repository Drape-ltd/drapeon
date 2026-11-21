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
