-- Fix the Phase 2 exposure trigger's payout-currency field reference and keep
-- order/profile comparisons portable across UUID and legacy text identifiers.

create or replace function private.record_order_payment_exposure_at_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.stage::text not in ('QUOTE_SENT', 'PENDING_QUOTE')
    or new.stage::text <> 'PAYMENT_PENDING'
    or old.accepted_route_snapshot_at is not null
    or new.accepted_route_snapshot_at is null then
    return new;
  end if;

  if new.accepted_earning_amount is null
    or new.accepted_earning_amount < 0
    or new.payment_route_id is null
    or new.payment_route_version is null
    or new.tailor_payout_currency_locked is null
    or new.charge_currency_snapshot is null
    or new.tailor_profile_id is null then
    raise exception 'ORDER_EXPOSURE_ACCEPTANCE_SNAPSHOT_INCOMPLETE';
  end if;

  insert into public.order_payment_exposure_measurements (
    order_id,
    tailor_profile_id,
    payment_route_id,
    payment_route_version,
    accepted_earning_amount,
    charge_currency,
    payout_currency,
    cap_limit_amount,
    confirmed_transfer_amount,
    outstanding_earning_amount,
    measurement_status,
    accepted_at
  ) values (
    new.id,
    new.tailor_profile_id,
    new.payment_route_id,
    new.payment_route_version,
    new.accepted_earning_amount,
    new.charge_currency_snapshot::public.currency,
    new.tailor_payout_currency_locked::public.currency,
    null,
    0,
    new.accepted_earning_amount,
    'OPEN',
    new.accepted_route_snapshot_at
  );

  return new;
end
$function$;

create or replace function private.refresh_order_payment_exposure_from_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order_id text := coalesce(new.order_id::text, old.order_id::text);
  v_exposure public.order_payment_exposure_measurements%rowtype;
  v_confirmed_payout_currency integer;
  v_has_confirmed_currency_mismatch boolean;
  v_status text;
begin
  if v_order_id is null then return coalesce(new, old); end if;

  select * into v_exposure
  from public.order_payment_exposure_measurements
  where order_id::text = v_order_id
  for update;
  if v_exposure.order_id is null then return coalesce(new, old); end if;

  select
    coalesce(sum(p.amount) filter (
      where p.currency::text = v_exposure.payout_currency::text
        and p.provider_transfer_status in ('AVAILABLE_IN_PROVIDER_BALANCE', 'PAID_TO_BANK')
        and p.status::text not in ('FAILED', 'REVERSED', 'CANCELED', 'BLOCKED')
    ), 0)::integer,
    coalesce(bool_or(
      p.currency::text <> v_exposure.payout_currency::text
      and p.provider_transfer_status in ('AVAILABLE_IN_PROVIDER_BALANCE', 'PAID_TO_BANK')
      and p.status::text not in ('FAILED', 'REVERSED', 'CANCELED', 'BLOCKED')
    ), false)
  into v_confirmed_payout_currency, v_has_confirmed_currency_mismatch
  from public.payouts p
  where p.order_id::text = v_exposure.order_id::text
    and p.payout_purpose in ('ORDER_EARNING', 'SETTLEMENT_TRANCHE');

  v_status := case
    when v_confirmed_payout_currency > v_exposure.accepted_earning_amount then 'OVERPAID'
    when v_has_confirmed_currency_mismatch then 'CURRENCY_MISMATCH'
    when v_confirmed_payout_currency = v_exposure.accepted_earning_amount then 'FULLY_RELEASED'
    else 'OPEN'
  end;

  update public.order_payment_exposure_measurements
  set confirmed_transfer_amount = v_confirmed_payout_currency,
      outstanding_earning_amount = greatest(accepted_earning_amount - v_confirmed_payout_currency, 0),
      measurement_status = v_status,
      updated_at = now()
  where order_id::text = v_exposure.order_id::text;

  return coalesce(new, old);
end
$function$;

revoke all on function private.record_order_payment_exposure_at_acceptance()
  from public, anon, authenticated;
revoke all on function private.refresh_order_payment_exposure_from_payout()
  from public, anon, authenticated;
grant execute on function private.record_order_payment_exposure_at_acceptance()
  to service_role;
grant execute on function private.refresh_order_payment_exposure_from_payout()
  to service_role;
