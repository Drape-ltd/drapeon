-- Ops-only aggregate of the existing acceptance-time earning measure.
-- This does not calculate dispute/refund reserve, provider balance, or a cap.

create view public.payout_account_accepted_earning_exposure_summary
with (security_invoker = true)
as
select
  exposure.tailor_profile_id,
  profiles.display_name as tailor_display_name,
  exposure.payment_route_id,
  exposure.payment_route_version,
  routes.route_key,
  routes.provider,
  routes.legal_entity,
  exposure.charge_currency,
  exposure.payout_currency,
  count(*)::bigint as exposed_order_count,
  coalesce(sum(exposure.accepted_earning_amount), 0)::bigint as accepted_earning_minor,
  coalesce(sum(exposure.confirmed_transfer_amount), 0)::bigint as confirmed_transfer_minor,
  coalesce(sum(exposure.outstanding_earning_amount), 0)::bigint as outstanding_earning_minor,
  count(*) filter (where exposure.measurement_status = 'OPEN')::bigint as open_order_count,
  count(*) filter (where exposure.measurement_status = 'OVERPAID')::bigint as overpaid_order_count,
  count(*) filter (where exposure.measurement_status = 'CURRENCY_MISMATCH')::bigint as currency_mismatch_order_count,
  min(exposure.accepted_at) filter (
    where exposure.measurement_status = 'OPEN' and exposure.outstanding_earning_amount > 0
  ) as oldest_open_acceptance_at,
  max(exposure.updated_at) as latest_measurement_at
from public.order_payment_exposure_measurements exposure
join public.tailor_profiles profiles
  on profiles.id = exposure.tailor_profile_id
join public.payment_routes routes
  on routes.id = exposure.payment_route_id
  and routes.version = exposure.payment_route_version
where exposure.measurement_status in ('OPEN', 'OVERPAID', 'CURRENCY_MISMATCH')
group by
  exposure.tailor_profile_id,
  profiles.display_name,
  exposure.payment_route_id,
  exposure.payment_route_version,
  routes.route_key,
  routes.provider,
  routes.legal_entity,
  exposure.charge_currency,
  exposure.payout_currency;

revoke all on public.payout_account_accepted_earning_exposure_summary
  from public, anon, authenticated, service_role;
grant select on public.payout_account_accepted_earning_exposure_summary to service_role;

comment on view public.payout_account_accepted_earning_exposure_summary is
  'Ops-only aggregate of accepted routed tailor earnings not yet provider-confirmed, grouped by tailor and accepted route. It is not chargeback/refund reserve exposure, current provider balance, recovery capacity, or a payout cap.';
