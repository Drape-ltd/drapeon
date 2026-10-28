-- Rollback for the Phase 2 route/delivery-country schema foundation.
-- This removes configuration and order snapshots; use only before any accepted
-- order has stored these fields and after confirming the new tables are unused.

do $guard$
begin
  if exists (
    select 1 from public.orders where accepted_route_snapshot_at is not null
  ) then
    raise exception 'Cannot roll back route snapshots after an order has accepted one.';
  end if;
  if exists (select 1 from public.payment_routes)
    or exists (select 1 from public.delivery_country_rules)
    or exists (select 1 from public.payout_destinations)
    or exists (select 1 from public.payment_route_approvals)
    or exists (select 1 from public.payment_route_audit_events)
    or exists (select 1 from public.delivery_country_audit_events) then
    raise exception 'Cannot roll back route schema while configuration or audit rows exist.';
  end if;
end
$guard$;

drop trigger if exists orders_accepted_payment_route_snapshot_immutable on public.orders;
drop function if exists private.guard_accepted_payment_route_snapshot();

drop trigger if exists payment_routes_audit_event on public.payment_routes;
drop trigger if exists payment_routes_audit_guard on public.payment_routes;
drop trigger if exists delivery_country_rules_audit_event on public.delivery_country_rules;
drop trigger if exists delivery_country_rules_audit_guard on public.delivery_country_rules;
drop trigger if exists payout_destination_identity_immutable on public.payout_destinations;

drop function if exists private.audit_payment_route_change();
drop function if exists private.guard_payment_route_change();
drop function if exists private.audit_delivery_country_rule_change();
drop function if exists private.guard_delivery_country_rule_change();
drop function if exists private.guard_payout_destination_identity();

alter table public.orders
  drop constraint if exists orders_route_snapshot_complete_check,
  drop constraint if exists orders_route_snapshot_tax_duty_object_check,
  drop constraint if exists orders_unaccepted_route_snapshot_empty_check,
  drop constraint if exists orders_route_snapshot_earning_check,
  drop constraint if exists orders_route_snapshot_provider_entity_check,
  drop constraint if exists orders_route_snapshot_entity_check,
  drop constraint if exists orders_route_snapshot_provider_check,
  drop constraint if exists orders_delivery_rule_version_pair_check,
  drop constraint if exists orders_payment_route_version_pair_check,
  drop constraint if exists orders_delivery_country_rule_version_fk,
  drop constraint if exists orders_payment_route_version_fk;

alter table public.orders
  drop column if exists accepted_route_snapshot_at,
  drop column if exists tailor_terms_version_snapshot,
  drop column if exists accepted_earning_amount,
  drop column if exists tax_duty_snapshot,
  drop column if exists delivery_country_rule_version,
  drop column if exists delivery_country_rule_id,
  drop column if exists fee_schedule_version_snapshot,
  drop column if exists payout_destination_id,
  drop column if exists charge_currency_snapshot,
  drop column if exists charge_provider_snapshot,
  drop column if exists legal_entity_snapshot,
  drop column if exists payment_route_version,
  drop column if exists payment_route_id;

drop table if exists public.payment_route_audit_events;
drop table if exists public.payment_route_approvals;
drop table if exists public.delivery_country_audit_events;
drop table if exists public.payout_destinations;
drop table if exists public.delivery_country_rules;
drop table if exists public.payment_routes;
