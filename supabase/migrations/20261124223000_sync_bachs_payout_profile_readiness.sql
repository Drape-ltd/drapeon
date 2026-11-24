-- Bachs onboarding never wrote tailor_profiles payout readiness, so every
-- surface and server gate that reads payout_account_verified (accept order,
-- send quote, publish paid items, readiness reminders) treated a fully
-- connected Bachs tailor as "payout setup required".
--
-- Mirror sync_stripe_payout_profile_readiness: one service-role-only writer
-- that records provider evidence for the tailor's own BACHS payout
-- destination. It never touches a profile pinned to Stripe or Paystack, and it
-- does not clear Ops' first-payout review: money release stays gated by
-- payout_destinations.active / first_withdrawal_review_status.

create or replace function public.sync_bachs_payout_profile_readiness(
  p_profile_id text,
  p_provider_account_ref text,
  p_ready boolean,
  p_country_code text,
  p_payout_currency text,
  p_observed_at timestamptz
)
returns table (
  transitioned boolean,
  payout_account_verified boolean,
  payout_reverification_required boolean,
  skipped_reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.tailor_profiles%rowtype;
  v_account_ref text := nullif(btrim(p_provider_account_ref), '');
  v_country_code text := nullif(upper(btrim(p_country_code)), '');
  v_currency text := nullif(upper(btrim(p_payout_currency)), '');
  v_verified_at timestamptz;
begin
  if v_account_ref is null or v_account_ref !~ '^acct_[A-Za-z0-9_-]+$' then
    raise exception 'BACHS_PAYOUT_ACCOUNT_REF_REQUIRED' using errcode = '22023';
  end if;
  if p_ready is null or p_observed_at is null then
    raise exception 'BACHS_PAYOUT_READINESS_INPUT_REQUIRED' using errcode = '22023';
  end if;
  if v_country_code is not null and v_country_code !~ '^[A-Z]{2}$' then
    raise exception 'BACHS_PAYOUT_COUNTRY_INVALID' using errcode = '22023';
  end if;
  if v_currency is not null and v_currency !~ '^[A-Z]{3}$' then
    raise exception 'BACHS_PAYOUT_CURRENCY_INVALID' using errcode = '22023';
  end if;

  -- The destination must already be bound to this profile and Bachs account.
  if not exists (
    select 1 from public.payout_destinations d
    where d.tailor_profile_id::text = p_profile_id
      and d.provider = 'BACHS'
      and d.provider_account_ref = v_account_ref
  ) then
    raise exception 'BACHS_PAYOUT_DESTINATION_NOT_BOUND' using errcode = '42501';
  end if;

  select * into v_profile
  from public.tailor_profiles
  where id::text = p_profile_id
  for update;
  if not found then
    raise exception 'BACHS_PAYOUT_PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Never overwrite another provider's pinned payout path.
  if v_profile.payout_account_type is not null
     or nullif(btrim(v_profile.stripe_connect_account_id), '') is not null
     or nullif(btrim(v_profile.stripe_account_id), '') is not null
     or nullif(btrim(v_profile.paystack_recipient_code), '') is not null
     or v_profile.manual_bank_entry is true then
    return query select false, v_profile.payout_account_verified,
      v_profile.payout_reverification_required, 'OTHER_PROVIDER_PINNED'::text;
    return;
  end if;

  v_verified_at := case
    when p_ready then coalesce(v_profile.payout_account_verified_at, p_observed_at)
    else null
  end;

  if v_profile.payout_account_verified is not distinct from p_ready
     and v_profile.payout_reverification_required is not distinct from not p_ready
     and v_profile.payout_account_verified_at is not distinct from v_verified_at
     and v_profile.payout_provider is not distinct from 'BACHS'::public.payment_provider
     and (v_country_code is null or v_profile.payout_country_code is not distinct from v_country_code)
     and (v_currency is null or v_profile.payout_currency::text is not distinct from v_currency) then
    return query select false, v_profile.payout_account_verified,
      v_profile.payout_reverification_required, null::text;
    return;
  end if;

  perform set_config('drape.identity_verification_trusted_write', 'true', true);
  begin
    update public.tailor_profiles
    set payout_account_verified = p_ready,
        payout_reverification_required = not p_ready,
        payout_account_verified_at = v_verified_at,
        payout_provider = 'BACHS'::public.payment_provider,
        payout_country_code = coalesce(v_country_code, payout_country_code),
        payout_currency = coalesce(v_currency::public.currency, payout_currency)
    where id::text = p_profile_id;
  exception when others then
    perform set_config('drape.identity_verification_trusted_write', '', true);
    raise;
  end;
  perform set_config('drape.identity_verification_trusted_write', '', true);

  return query select true, p_ready, not p_ready, null::text;
end
$$;

revoke all on function public.sync_bachs_payout_profile_readiness(text,text,boolean,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.sync_bachs_payout_profile_readiness(text,text,boolean,text,text,timestamptz)
  to service_role;
