-- Stripe capability refreshes are provider evidence, not payout destination
-- replacement requests. Keep the general profile guard strict and expose one
-- service-role-only writer that can update readiness for the already-pinned
-- Stripe account. Identical observations are true no-ops and preserve the
-- original verification timestamp.

create or replace function public.sync_stripe_payout_profile_readiness(
  p_profile_id text,
  p_stripe_account_id text,
  p_verified boolean,
  p_country_code text,
  p_observed_at timestamptz
)
returns table (
  transitioned boolean,
  payout_account_verified boolean,
  payout_reverification_required boolean,
  payout_account_verified_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.tailor_profiles%rowtype;
  v_account_id text := nullif(btrim(p_stripe_account_id), '');
  v_country_code text := nullif(upper(btrim(p_country_code)), '');
  v_verified_at timestamptz;
begin
  if v_account_id is null then
    raise exception 'STRIPE_PAYOUT_ACCOUNT_ID_REQUIRED' using errcode = '22023';
  end if;
  if p_observed_at is null then
    raise exception 'STRIPE_PAYOUT_OBSERVED_AT_REQUIRED' using errcode = '22023';
  end if;
  if v_country_code is not null and v_country_code !~ '^[A-Z]{2}$' then
    raise exception 'STRIPE_PAYOUT_COUNTRY_INVALID' using errcode = '22023';
  end if;

  select * into v_profile
  from public.tailor_profiles
  where id = p_profile_id
  for update;

  if not found then
    raise exception 'STRIPE_PAYOUT_PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if coalesce(v_profile.payout_provider::text, '') <> 'STRIPE'
     or coalesce(v_profile.payout_account_type::text, '') <> 'STRIPE_CONNECT'
     or nullif(btrim(v_profile.stripe_connect_account_id), '') is distinct from v_account_id
     or nullif(btrim(v_profile.stripe_account_id), '') is distinct from v_account_id then
    raise exception 'STRIPE_PAYOUT_PINNED_ACCOUNT_MISMATCH' using errcode = '42501';
  end if;

  v_verified_at := case
    when p_verified then coalesce(v_profile.payout_account_verified_at, p_observed_at)
    else null
  end;

  if v_profile.payout_account_verified is not distinct from p_verified
     and v_profile.payout_reverification_required is not distinct from not p_verified
     and v_profile.payout_account_verified_at is not distinct from v_verified_at
     and (v_country_code is null or v_profile.payout_country_code is not distinct from v_country_code) then
    return query select false, v_profile.payout_account_verified,
      v_profile.payout_reverification_required, v_profile.payout_account_verified_at;
    return;
  end if;

  perform set_config('drape.identity_verification_trusted_write', 'true', true);
  begin
    update public.tailor_profiles
    set payout_account_verified = p_verified,
        payout_reverification_required = not p_verified,
        payout_account_verified_at = v_verified_at,
        payout_country_code = coalesce(v_country_code, payout_country_code)
    where id = p_profile_id;
  exception when others then
    perform set_config('drape.identity_verification_trusted_write', '', true);
    raise;
  end;
  perform set_config('drape.identity_verification_trusted_write', '', true);

  return query select true, p_verified, not p_verified, v_verified_at;
end
$$;

revoke all on function public.sync_stripe_payout_profile_readiness(text,text,boolean,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.sync_stripe_payout_profile_readiness(text,text,boolean,text,timestamptz)
  to service_role;
