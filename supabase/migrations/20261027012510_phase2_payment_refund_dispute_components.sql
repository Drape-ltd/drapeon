-- Ops-only, non-additive collection/refund/dispute components for routed-order
-- exposure review. Refunds and disputes may describe the same charge and must
-- never be summed into one "reserve" number. This view also is not a provider
-- balance or recovery-capacity measure.

create view public.payout_account_payment_risk_components
with (security_invoker = true)
as
with captured_payments as (
  select
    payment.id,
    payment.order_id,
    payment.phase::text as payment_phase,
    payment.provider::text as observed_provider,
    payment.currency::text as currency,
    payment.amount::bigint as captured_amount_minor,
    coalesce(payment.refunded_amount, 0)::bigint as recorded_refund_minor,
    payment.status::text as payment_status,
    payment.confirmed_at,
    payment.updated_at
  from public.order_payments payment
  where payment.status::text in ('SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED')
), payment_groups as (
  select
    order_row.tailor_profile_id::text as tailor_profile_id,
    order_row.payment_route_id,
    order_row.payment_route_version,
    coalesce(route.route_key, 'LEGACY_OR_UNSNAPSHOTTED') as route_key,
    coalesce(order_row.legal_entity_snapshot, 'LEGACY_OR_UNSNAPSHOTTED') as legal_entity,
    coalesce(order_row.charge_provider_snapshot, 'LEGACY_OR_UNSNAPSHOTTED') as route_provider_snapshot,
    payment.observed_provider,
    payment.currency,
    payment.payment_phase,
    count(*)::bigint as captured_payment_count,
    coalesce(sum(payment.captured_amount_minor), 0)::bigint as captured_gross_minor,
    coalesce(sum(payment.recorded_refund_minor), 0)::bigint as recorded_refund_minor,
    coalesce(sum(greatest(payment.captured_amount_minor - payment.recorded_refund_minor, 0)), 0)::bigint
      as net_after_recorded_refunds_minor,
    count(*) filter (where order_row.payment_route_id is null)::bigint as unsnapshotted_payment_count,
    count(*) filter (
      where order_row.payment_route_id is not null
        and (
          route.id is null
          or route.provider::text is distinct from order_row.charge_provider_snapshot
          or order_row.charge_provider_snapshot is distinct from payment.observed_provider
          or order_row.charge_currency_snapshot is distinct from payment.currency
          or route.charge_currency::text is distinct from order_row.charge_currency_snapshot
          or route.payout_currency::text is distinct from order_row.tailor_payout_currency_locked::text
        )
    )::bigint as snapshot_mismatch_count,
    count(*) filter (
      where (payment.payment_status = 'REFUNDED' and payment.recorded_refund_minor <> payment.captured_amount_minor)
        or (payment.payment_status = 'PARTIAL_REFUND' and payment.recorded_refund_minor in (0, payment.captured_amount_minor))
        or (payment.payment_status = 'SUCCEEDED' and payment.recorded_refund_minor > 0)
    )::bigint as refund_status_mismatch_count,
    min(payment.confirmed_at) as oldest_payment_confirmed_at,
    max(coalesce(payment.confirmed_at, payment.updated_at)) as latest_payment_observed_at
  from captured_payments payment
  left join public.orders order_row
    on order_row.id::text = payment.order_id::text
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
    payment.observed_provider,
    payment.currency,
    payment.payment_phase
), open_disputes as (
  select
    dispute.id,
    dispute.order_id,
    dispute.payment_id,
    dispute.provider::text as observed_provider,
    dispute.currency::text as currency,
    dispute.amount::bigint as disputed_amount_minor,
    dispute.status,
    dispute.opened_at,
    dispute.evidence_due_at,
    payment.order_id as payment_order_id,
    payment.phase::text as linked_payment_phase,
    payment.provider::text as linked_payment_provider,
    payment.currency::text as linked_payment_currency,
    payment.provider_payment_id as linked_provider_payment_id,
    case
      when payment.id is null and dispute.order_id is not null then 'ORDER_ONLY'
      when payment.id is null then 'UNLINKED'
      when payment.provider::text is distinct from dispute.provider::text
        or payment.currency::text is distinct from dispute.currency::text
        or (dispute.provider_payment_id is not null and payment.provider_payment_id is distinct from dispute.provider_payment_id)
        or (dispute.order_id is not null and payment.order_id::text is distinct from dispute.order_id::text)
        then 'LINK_MISMATCH'
      else 'PAYMENT_LINKED'
    end as link_quality
  from public.provider_disputes dispute
  left join public.order_payments payment
    on payment.id = dispute.payment_id
  where dispute.status in ('NEEDS_RESPONSE', 'UNDER_REVIEW', 'UNKNOWN')
), dispute_groups as (
  select
    order_row.tailor_profile_id::text as tailor_profile_id,
    order_row.payment_route_id,
    order_row.payment_route_version,
    coalesce(route.route_key, 'LEGACY_OR_UNSNAPSHOTTED') as route_key,
    coalesce(order_row.legal_entity_snapshot, 'LEGACY_OR_UNSNAPSHOTTED') as legal_entity,
    coalesce(order_row.charge_provider_snapshot, 'LEGACY_OR_UNSNAPSHOTTED') as route_provider_snapshot,
    dispute.observed_provider,
    dispute.currency,
    case when dispute.link_quality = 'PAYMENT_LINKED' then dispute.linked_payment_phase else 'UNRESOLVED' end as payment_phase,
    dispute.link_quality,
    count(*)::bigint as open_dispute_count,
    coalesce(sum(dispute.disputed_amount_minor), 0)::bigint as open_dispute_minor,
    count(*) filter (where dispute.evidence_due_at is not null)::bigint as disputes_with_evidence_deadline_count,
    min(dispute.evidence_due_at) as earliest_evidence_due_at,
    min(dispute.opened_at) as oldest_dispute_opened_at,
    max(dispute.opened_at) as latest_dispute_opened_at
  from open_disputes dispute
  left join public.orders order_row
    on order_row.id::text = (
      case
        when dispute.link_quality = 'PAYMENT_LINKED' then dispute.payment_order_id::text
        when dispute.order_id is not null then dispute.order_id::text
        else null
      end
    )
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
    dispute.observed_provider,
    dispute.currency,
    case when dispute.link_quality = 'PAYMENT_LINKED' then dispute.linked_payment_phase else 'UNRESOLVED' end,
    dispute.link_quality
)
select
  payment.tailor_profile_id,
  payment.payment_route_id,
  payment.payment_route_version,
  payment.route_key,
  payment.legal_entity,
  payment.route_provider_snapshot,
  payment.observed_provider,
  payment.currency,
  payment.payment_phase,
  'CAPTURED_PAYMENT'::text as component_type,
  'PAYMENT_RECORD'::text as link_quality,
  payment.captured_payment_count,
  payment.captured_gross_minor,
  payment.recorded_refund_minor,
  payment.net_after_recorded_refunds_minor,
  0::bigint as open_dispute_count,
  0::bigint as open_dispute_minor,
  payment.unsnapshotted_payment_count,
  payment.snapshot_mismatch_count,
  payment.refund_status_mismatch_count,
  0::bigint as disputes_with_evidence_deadline_count,
  null::timestamptz as earliest_evidence_due_at,
  payment.oldest_payment_confirmed_at as oldest_event_at,
  payment.latest_payment_observed_at as latest_event_at
from payment_groups payment

union all

select
  dispute.tailor_profile_id,
  dispute.payment_route_id,
  dispute.payment_route_version,
  dispute.route_key,
  dispute.legal_entity,
  dispute.route_provider_snapshot,
  dispute.observed_provider,
  dispute.currency,
  dispute.payment_phase,
  'OPEN_DISPUTE'::text as component_type,
  dispute.link_quality,
  0::bigint as captured_payment_count,
  0::bigint as captured_gross_minor,
  0::bigint as recorded_refund_minor,
  0::bigint as net_after_recorded_refunds_minor,
  dispute.open_dispute_count,
  dispute.open_dispute_minor,
  0::bigint as unsnapshotted_payment_count,
  0::bigint as snapshot_mismatch_count,
  0::bigint as refund_status_mismatch_count,
  dispute.disputes_with_evidence_deadline_count,
  dispute.earliest_evidence_due_at,
  dispute.oldest_dispute_opened_at as oldest_event_at,
  dispute.latest_dispute_opened_at as latest_event_at
from dispute_groups dispute;

revoke all on public.payout_account_payment_risk_components
  from public, anon, authenticated, service_role;
grant select on public.payout_account_payment_risk_components to service_role;

comment on view public.payout_account_payment_risk_components is
  'Ops-only, non-additive view of captured payments, recorded refunds, and open provider disputes grouped by the order snapshot and payment phase. Disputes can overlap refunds. It does not include pending refund claims, provider balance, recovery capacity, or a reserve/cap total.';
