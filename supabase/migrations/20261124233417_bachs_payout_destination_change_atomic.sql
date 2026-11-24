-- The provider has verified the new destination before this RPC is called.
-- Commit the destination swap, tailor summary, request outcome and audit in
-- one transaction. The service caller supplies the observed provider id;
-- the request must already contain that exact id from a Bachs refresh.
create or replace function public.confirm_bachs_payout_destination_change(
  p_request_id uuid,
  p_tailor_user_id uuid,
  p_provider_destination_ref text,
  p_observed_at timestamptz
)
returns table (request_id uuid, destination_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.payout_change_requests%rowtype;
  v_destination public.payout_destinations%rowtype;
  v_new_ref text := nullif(btrim(p_provider_destination_ref), '');
begin
  if p_request_id is null or p_tailor_user_id is null or p_observed_at is null
     or v_new_ref is null or v_new_ref !~ '^pd_[A-Za-z0-9_-]+$' then
    raise exception 'BACHS_CHANGE_INPUT_INVALID' using errcode = '22023';
  end if;

  select * into v_request from public.payout_change_requests
  where id = p_request_id for update;
  if not found or v_request.tailor_user_id <> p_tailor_user_id
     or v_request.status <> 'PENDING'
     or v_request.metadata ->> 'change_kind' <> 'BACHS_DESTINATION'
     or v_request.requested_destination ->> 'payout_provider' <> 'BACHS'
     or v_request.requested_destination ->> 'provider_destination_ref' <> v_new_ref
     or nullif(v_request.requested_destination ->> 'provider_account_ref', '') is null
     or v_request.current_destination ->> 'provider_destination_ref' = v_new_ref then
    raise exception 'BACHS_CHANGE_REQUEST_NOT_CONFIRMABLE' using errcode = 'P0001';
  end if;
  if nullif(v_request.metadata ->> 'confirmation_expires_at', '') is null
     or (v_request.metadata ->> 'confirmation_expires_at')::timestamptz <= p_observed_at then
    raise exception 'BACHS_CHANGE_CONFIRMATION_EXPIRED' using errcode = 'P0001';
  end if;

  select * into v_destination from public.payout_destinations
  where tailor_profile_id::text = v_request.tailor_profile_id
    and provider = 'BACHS'
    and provider_account_ref = v_request.current_destination ->> 'provider_account_ref'
  for update;
  if not found
     or v_destination.provider_destination_ref is distinct from
       v_request.current_destination ->> 'provider_destination_ref'
     or v_destination.provider_account_ref is distinct from
       v_request.requested_destination ->> 'provider_account_ref' then
    raise exception 'BACHS_CHANGE_CURRENT_DESTINATION_CHANGED' using errcode = 'P0001';
  end if;

  update public.payout_destinations
  set provider_destination_ref = v_new_ref,
      provider_external_account_present = true,
      capability_checked_at = p_observed_at,
      updated_at = p_observed_at
  where id = v_destination.id;

  perform set_config('drape.identity_verification_trusted_write', 'true', true);
  update public.tailor_profiles
  set payout_bank_name = nullif(v_request.requested_destination ->> 'payout_bank_name', ''),
      payout_account_name = nullif(v_request.requested_destination ->> 'payout_account_name', ''),
      payout_account_masked = nullif(v_request.requested_destination ->> 'payout_account_masked', ''),
      payout_account_verified = true,
      payout_reverification_required = false,
      payout_account_verified_at = p_observed_at,
      payout_account_change_count = coalesce(payout_account_change_count, 0) + 1,
      payout_account_last_changed_at = p_observed_at,
      payout_account_change_locked_until = p_observed_at + interval '7 days',
      updated_at = p_observed_at
  where id::text = v_request.tailor_profile_id
    and user_id::text = p_tailor_user_id::text;
  if not found then
    raise exception 'BACHS_CHANGE_PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform set_config('drape.identity_verification_trusted_write', '', true);

  update public.payout_change_requests
  set status = 'APPROVED', reviewed_at = p_observed_at,
      metadata = metadata || jsonb_build_object(
        'lifecycle_state', 'ACTIVATED',
        'confirmation_status', 'CONFIRMED',
        'confirmed_at', p_observed_at,
        'activated_at', p_observed_at
      ),
      updated_at = p_observed_at
  where id = v_request.id;

  insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
  values (p_tailor_user_id::text, 'TAILOR', 'seller.bachs_payout_change_confirmed', 'info',
    jsonb_build_object('request_id', v_request.id,
      'destination_id', v_destination.id,
      'provider_destination_ref', v_new_ref));

  return query select v_request.id, v_destination.id, 'APPROVED'::text;
end $$;

revoke all on function public.confirm_bachs_payout_destination_change(uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.confirm_bachs_payout_destination_change(uuid,uuid,text,timestamptz)
  to service_role;
