-- Draft for a separately approved, read-only Production preflight.
-- Do not execute without the owner's approval for the exact read step.
-- Record only counts and plan shape in the public release worksheet;
-- retain Production-specific findings in the private Ops ledger.

-- Exact prerequisite history before PAY-003 Batch 1. Any missing or
-- unexpected generated version stops release planning.
with expected(version) as (
  values
    ('20261029000000'), ('20261029000500'), ('20261029001000'),
    ('20261029001500'), ('20261029002000'), ('20261029002500'),
    ('20261029003000'), ('20261029043814'), ('20261029062510'),
    ('20261029063007'), ('20261029131928'), ('20261029132040')
)
select expected.version,
       exists (select 1 from supabase_migrations.schema_migrations applied
               where applied.version = expected.version) as applied
from expected order by expected.version;

-- Report the entire candidate release range; reconcile every version
-- with the reviewed source list before each batch.
select version, name
from supabase_migrations.schema_migrations
where version >= '20261029000000'
order by version;

-- PAY-003 invariant check. Every count must be zero before and after Batch 1.
select
  count(*) filter (where status = 'SUCCEEDED' and coalesce(refunded_amount, 0) > 0)
    as succeeded_with_refund,
  count(*) filter (where status = 'REFUNDED' and coalesce(refunded_amount, 0) <> amount)
    as refunded_amount_mismatch,
  count(*) filter (where status = 'PARTIAL_REFUND'
                   and (coalesce(refunded_amount, 0) <= 0 or refunded_amount >= amount))
    as invalid_partial_refund,
  count(*) filter (where coalesce(refunded_amount, 0) > amount)
    as over_refunded,
  count(*) filter (where refunded_at is not null
                   and status not in ('REFUNDED', 'PARTIAL_REFUND'))
    as refund_timestamp_status_mismatch
from public.order_payments;

-- Exact 20261030050000 legacy baseline predicate and its read-only plan.
select count(*) as pay003_legacy_baseline_rows
from public.order_payments payment
where coalesce(payment.refunded_amount, 0) > 0
  and not exists (
    select 1 from public.order_payment_provider_refunds provider_refund
    where provider_refund.payment_id = payment.id
  );

explain (format json)
select payment.id
from public.order_payments payment
where coalesce(payment.refunded_amount, 0) > 0
  and not exists (
    select 1 from public.order_payment_provider_refunds provider_refund
    where provider_refund.payment_id = payment.id
  );

-- Exact 20261030110000 C2 destination candidate source. Report both
-- repairable and conflicting null-destination payouts before Batch 2.
with candidates as (
  select claim.payout_id, claim.provider_destination_id
  from public.payout_claims claim
  where nullif(btrim(claim.provider_destination_id), '') is not null
  union all
  select tip_claim.payout_id,
    nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'), '')
  from public.tip_money_operation_claims tip_claim
  where nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'), '') is not null
), grouped as (
  select payout_id, count(distinct provider_destination_id) as destination_count
  from candidates group by payout_id
)
select count(*) filter (where destination_count = 1) as repairable,
       count(*) filter (where destination_count > 1) as conflicting
from grouped join public.payouts payout on payout.id::text = grouped.payout_id
where payout.provider_destination_id is null;

-- Check due work before the bounded scheduler batch. No job is mutated.
select job_type, status, count(*) as jobs, min(created_at) as oldest_created_at
from public.job_queue
where job_type in (
  'PROCESS_DISPATCH_REFUND', 'RECONCILE_DISPATCH_RUN',
  'PROCESS_DELIVERY_WEBHOOK', 'RECONCILE_DELIVERY_WEBHOOK',
  'SEND_COMMUNICATION_CAMPAIGN'
)
  and status in ('PENDING', 'RETRYABLE', 'PROCESSING')
group by job_type, status
order by job_type, status;
