-- Pending refund work is a separate exposure component from captured refunds.
-- Sources can overlap stages of one refund, so this view stays non-additive.

create or replace view public.payout_account_pending_refund_components
with (security_invoker = true)
as
with refund_components as (
  select
    resolution.order_id::text as order_id,
    null::text as observed_provider,
    resolution.currency::text as currency,
    'UNRESOLVED'::text as payment_phase,
    'REFUND_RESOLUTION'::text as component_type,
    resolution.status::text as component_status,
    'ORDER_ONLY'::text as link_quality,
    resolution.amount::bigint as amount_minor,
    resolution.created_at,
    resolution.updated_at
  from public.order_refund_resolutions resolution
  where resolution.status in ('MONEY_DESK_REQUIRED', 'APPROVAL_PENDING', 'APPROVED', 'PROCESSING', 'BLOCKED')

  union all

  select
    request.order_id::text as order_id,
    null::text as observed_provider,
    request.currency::text as currency,
    'UNRESOLVED'::text as payment_phase,
    'MONEY_DESK_REFUND_REQUEST'::text as component_type,
    request.status::text as component_status,
    case when request.order_id is null then 'UNLINKED' else 'ORDER_ONLY' end::text as link_quality,
    coalesce(request.amount, 0)::bigint as amount_minor,
    request.created_at,
    request.updated_at
  from public.money_desk_requests request
  where request.action_type = 'CUSTOMER_REFUND'
    and request.status in ('PENDING_APPROVAL', 'APPROVED', 'EXECUTING')
    and not exists (
      select 1
      from public.order_refund_resolutions resolution
      where resolution.money_desk_request_id = request.id
        and resolution.status in ('MONEY_DESK_REQUIRED', 'APPROVAL_PENDING', 'APPROVED', 'PROCESSING', 'BLOCKED')
    )
    and not exists (
      select 1
      from public.consultation_post_payout_refund_claims claim
      where claim.money_desk_request_id = request.id
        and claim.status in ('CLAIMED', 'PROCESSING', 'PROVIDER_CONFIRMED', 'OPS_REVIEW')
    )

  union all

  select
    booking.order_id::text as order_id,
    claim.provider::text as observed_provider,
    claim.currency::text as currency,
    coalesce(payment.phase::text, 'UNRESOLVED') as payment_phase,
    'CONSULTATION_POST_PAYOUT_REFUND'::text as component_type,
    claim.status::text as component_status,
    case
      when payment.id is null then 'UNLINKED'
      when payment.phase::text = 'CONSULTATION'
        and payment.order_id::text = booking.order_id::text
        and payment.provider::text = claim.provider::text
        and payment.currency::text = claim.currency::text
        and payment.amount = claim.amount then 'PAYMENT_LINKED'
      else 'LINK_MISMATCH'
    end::text as link_quality,
    claim.amount::bigint as amount_minor,
    claim.created_at,
    claim.updated_at
  from public.consultation_post_payout_refund_claims claim
  join public.consultation_bookings booking on booking.id = claim.booking_id
  left join public.order_payments payment on payment.id = claim.payment_id
  where claim.status in ('CLAIMED', 'PROCESSING', 'PROVIDER_CONFIRMED', 'OPS_REVIEW')
)
select
  order_row.tailor_profile_id::text as tailor_profile_id,
  order_row.payment_route_id,
  order_row.payment_route_version,
  coalesce(route.route_key, 'LEGACY_OR_UNSNAPSHOTTED') as route_key,
  coalesce(order_row.legal_entity_snapshot, 'LEGACY_OR_UNSNAPSHOTTED') as legal_entity,
  coalesce(order_row.charge_provider_snapshot, 'LEGACY_OR_UNSNAPSHOTTED') as route_provider_snapshot,
  component.observed_provider,
  component.currency,
  component.payment_phase,
  component.component_type,
  component.component_status,
  component.link_quality,
  count(*)::bigint as refund_component_count,
  coalesce(sum(component.amount_minor), 0)::bigint as refund_amount_minor,
  min(component.created_at) as oldest_component_at,
  max(component.updated_at) as latest_component_at
from refund_components component
left join public.orders order_row on order_row.id::text = component.order_id
left join public.payment_routes route
  on route.id = order_row.payment_route_id
 and route.version = order_row.payment_route_version
group by
  order_row.tailor_profile_id,
  order_row.payment_route_id,
  order_row.payment_route_version,
  coalesce(route.route_key, 'LEGACY_OR_UNSNAPSHOTTED'),
  coalesce(order_row.legal_entity_snapshot, 'LEGACY_OR_UNSNAPSHOTTED'),
  coalesce(order_row.charge_provider_snapshot, 'LEGACY_OR_UNSNAPSHOTTED'),
  component.observed_provider,
  component.currency,
  component.payment_phase,
  component.component_type,
  component.component_status,
  component.link_quality;

revoke all on public.payout_account_pending_refund_components
  from public, anon, authenticated, service_role;
grant select on public.payout_account_pending_refund_components to service_role;

comment on view public.payout_account_pending_refund_components is
  'Ops-only, non-additive pending refund-work components from refund resolutions, active Money Desk refund requests, and post-payout consultation claims. It links to route snapshots where available but is not a provider balance, accepted earning, or reserve total; components may describe different stages of the same customer refund.';
