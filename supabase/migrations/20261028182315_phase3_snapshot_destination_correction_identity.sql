-- Bind a snapshot destination correction to the failed provider operation,
-- order, tailor, and immutable route. The Ops form checks this too, but the
-- database remains authoritative when a reviewed correction is recorded.
create or replace function private.guard_snapshot_destination_correction_prior_destination()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_route public.payment_routes%rowtype;
  v_payout public.payouts%rowtype;
  v_claim public.payout_claims%rowtype;
  v_previous public.payout_destinations%rowtype;
  v_replacement public.payout_destinations%rowtype;
  v_prior_operation public.payout_provider_operations%rowtype;
begin
  -- Legacy reviewed corrections do not carry a claim and keep their existing
  -- path. This guard is only for immutable accepted-route snapshots.
  if new.claim_id is null then
    return new;
  end if;

  select * into v_order from public.orders
    where id::text = new.order_id for share;
  select * into v_payout from public.payouts
    where id::text = new.failed_payout_id for share;
  select * into v_claim from public.payout_claims
    where id = new.claim_id for share;
  select * into v_previous from public.payout_destinations
    where id = new.previous_destination_id for share;
  select * into v_replacement from public.payout_destinations
    where id = new.replacement_destination_id for share;
  select * into v_route from public.payment_routes
    where id = v_order.payment_route_id
      and version = v_order.payment_route_version for share;
  select * into v_prior_operation from public.payout_provider_operations
    where claim_id = new.claim_id
      and operation_number = new.operation_number - 1
    for share;

  if v_order.id is null or v_order.accepted_route_snapshot_at is null
    or v_order.id::text is distinct from new.order_id
    or v_order.payout_destination_id is distinct from new.previous_destination_id
    or v_route.id is null
    or v_route.provider::text is distinct from v_order.charge_provider_snapshot
    or v_route.charge_currency is distinct from v_order.charge_currency_snapshot
    or v_route.legal_entity is distinct from v_order.legal_entity_snapshot
    or v_route.provider::text is distinct from new.provider::text
    or v_route.payout_currency is distinct from v_claim.currency::text
    or v_previous.id is null
    or v_previous.tailor_profile_id::text is distinct from v_order.tailor_profile_id::text
    or v_previous.provider::text is distinct from v_route.provider::text
    or v_previous.legal_entity is distinct from v_route.legal_entity
    or v_previous.country_code is distinct from v_route.tailor_country_code
    or v_previous.currency is distinct from v_route.payout_currency
    or v_previous.fees_collector is distinct from v_route.fees_collector
    or v_payout.id is null
    or v_payout.status is distinct from 'FAILED'
    or v_payout.payout_purpose is distinct from 'SETTLEMENT_TRANCHE'
    or v_payout.settlement_tranche_id::text is distinct from v_claim.source_id
    or v_payout.tailor_profile_id::text is distinct from v_order.tailor_profile_id::text
    or v_payout.provider::text is distinct from new.provider::text
    or v_payout.provider_destination_id is distinct from v_previous.provider_account_ref
    or v_claim.id is null
    or v_claim.source_kind is distinct from 'SETTLEMENT_TRANCHE'
    or v_claim.payout_id is distinct from v_payout.id::text
    or v_claim.order_id is distinct from v_order.id::text
    or v_claim.tailor_profile_id is distinct from v_order.tailor_profile_id::text
    or v_claim.provider is distinct from new.provider::text
    or v_claim.currency is distinct from v_payout.currency
    or v_claim.amount is distinct from v_payout.amount
    or v_claim.status is distinct from 'FAILED_RECONCILED'
    or v_claim.transfer_status is distinct from 'FAILED_RECONCILED'
    or new.tailor_profile_id::text is distinct from v_order.tailor_profile_id::text
    or new.provider::text is distinct from v_claim.provider
    or new.previous_destination_id is null
    or new.replacement_destination_id is null
    or new.previous_destination_id = new.replacement_destination_id
    or v_replacement.id is null
    or v_replacement.tailor_profile_id::text is distinct from v_order.tailor_profile_id::text
    or v_replacement.provider::text is distinct from v_route.provider::text
    or v_replacement.legal_entity is distinct from v_route.legal_entity
    or v_replacement.country_code is distinct from v_route.tailor_country_code
    or v_replacement.currency is distinct from v_route.payout_currency
    or v_replacement.fees_collector is distinct from v_route.fees_collector
    or not v_replacement.active
    or not v_replacement.transfers_enabled
    or not v_replacement.payouts_enabled
    or v_replacement.first_withdrawal_review_status is distinct from 'CLEARED'
    or v_replacement.capability_checked_at is null
    or v_replacement.capability_checked_at < now() - interval '15 minutes'
    or v_prior_operation.id is null
    or v_prior_operation.operation_number <> new.operation_number - 1
    or v_prior_operation.status is distinct from 'FAILED_RETURNED'
    or v_prior_operation.provider is distinct from new.provider::text
    or v_prior_operation.provider_destination_id is distinct from v_previous.provider_account_ref
    or v_prior_operation.currency is distinct from v_claim.currency
    or v_prior_operation.amount is distinct from v_claim.amount
    or nullif(btrim(v_prior_operation.final_failure_reference), '') is null
    or nullif(btrim(v_prior_operation.funds_return_reference), '') is null
    or v_prior_operation.funds_return_confirmed_at is null then
    raise exception using
      errcode = '23514',
      constraint = 'payout_destination_correction_prior_operation_matches_snapshot',
      message = 'Snapshot destination correction does not match the failed route, tailor, and latest returned-funds operation';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_snapshot_destination_correction_prior_destination()
  from public, anon, authenticated, service_role;

create trigger payout_destination_correction_prior_destination_guard
  before insert on public.payout_destination_corrections
  for each row execute function private.guard_snapshot_destination_correction_prior_destination();
