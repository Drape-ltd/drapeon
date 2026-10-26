-- Measurement-only reservation for the tailor earning accepted on a routed
-- order. It does not enforce a cap: cap_limit_amount is deliberately NULL
-- until a disclosed per-tailor policy and customer/tailor UX are activated.

create table public.order_payment_exposure_measurements (
  order_id text primary key references public.orders(id) on delete restrict,
  tailor_profile_id text not null references public.tailor_profiles(id) on delete restrict,
  payment_route_id uuid not null,
  payment_route_version integer not null,
  accepted_earning_amount integer not null check (accepted_earning_amount >= 0),
  charge_currency currency not null,
  payout_currency currency not null,
  cap_limit_amount integer check (cap_limit_amount is null or cap_limit_amount > 0),
  confirmed_transfer_amount integer not null default 0 check (confirmed_transfer_amount >= 0),
  outstanding_earning_amount integer not null check (outstanding_earning_amount >= 0),
  measurement_status text not null check (
    measurement_status in ('OPEN', 'FULLY_RELEASED', 'OVERPAID', 'CURRENCY_MISMATCH')
  ),
  policy_version text not null default 'accepted-earning-exposure-2026-10-v1',
  accepted_at timestamptz not null,
  updated_at timestamptz not null default now(),
  foreign key (payment_route_id, payment_route_version)
    references public.payment_routes(id, version) on delete restrict,
  check (confirmed_transfer_amount <= accepted_earning_amount or measurement_status = 'OVERPAID')
);

create index order_payment_exposure_tailor_currency_idx
  on public.order_payment_exposure_measurements
    (tailor_profile_id, payout_currency, measurement_status, accepted_at desc);

alter table public.order_payment_exposure_measurements enable row level security;
revoke all on public.order_payment_exposure_measurements from public, anon, authenticated;
grant select, insert, update on public.order_payment_exposure_measurements to service_role;

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
    or new.payout_currency_locked is null
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
    new.id::text,
    new.tailor_profile_id,
    new.payment_route_id,
    new.payment_route_version,
    new.accepted_earning_amount,
    new.charge_currency_snapshot::public.currency,
    new.payout_currency_locked::public.currency,
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
  where order_id = v_order_id
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
  where p.order_id::text = v_exposure.order_id
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
  where order_id = v_exposure.order_id;

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

create trigger orders_record_payment_exposure_at_acceptance
after update of stage on public.orders
for each row execute function private.record_order_payment_exposure_at_acceptance();

create trigger payouts_refresh_order_payment_exposure
after insert or update of status, provider_transfer_status, amount, currency, order_id, payout_purpose
on public.payouts
for each row execute function private.refresh_order_payment_exposure_from_payout();

comment on table public.order_payment_exposure_measurements is
  'Measurement-only, per-order accepted tailor earning reservation. accepted_earning_amount is denominated in payout_currency (as consumed by acceptedOrderPayoutMoney); tracks confirmed ORDER_EARNING/SETTLEMENT_TRANCHE transfers in that currency. Exposure remains outstanding until provider-confirmed transfer, including in-flight payouts. It does not include dispute-window loss, fabric/material advances, tips, or account-level withdrawals and does not enforce a cap.';
