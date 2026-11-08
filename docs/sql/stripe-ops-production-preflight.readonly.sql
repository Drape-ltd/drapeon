-- Stripe/Ops release preflight. READ ONLY. Do not run on Production without
-- the owner's separate approval for that exact read. Record counts and plans
-- privately; the public regression document must not contain Production IDs.

-- Batch 1 prerequisite inventory: all twelve 20261029 migrations must exist.
with expected(version) as (
  values ('20261029000000'), ('20261029000500'), ('20261029001000'),
    ('20261029001500'), ('20261029002000'), ('20261029002500'),
    ('20261029003000'), ('20261029043814'), ('20261029062510'),
    ('20261029063007'), ('20261029131928'), ('20261029132040')
)
select expected.version,
  (applied.version is not null) as applied
from expected
left join supabase_migrations.schema_migrations applied
  on applied.version = expected.version
order by expected.version;

-- PAY-003 legacy provider-refund backfill (20261030050000): candidate count.
select count(*) as candidate_rows
from public.order_payments payment
where coalesce(payment.refunded_amount, 0) > 0
  and not exists (
    select 1
    from public.order_payment_provider_refunds provider_refund
    where provider_refund.payment_id = payment.id
  );

-- PAY-003 read-only source plan. Compare with the approved Dev plan before
-- applying the data-only migration. EXPLAIN does not execute this SELECT.
explain (format json)
select payment.id
from public.order_payments payment
where coalesce(payment.refunded_amount, 0) > 0
  and not exists (
    select 1
    from public.order_payment_provider_refunds provider_refund
    where provider_refund.payment_id = payment.id
  );

-- C2 destination repair (20261030110000): count only unambiguous rows that
-- are still missing their pinned destination. No current-profile inference.
with candidates as (
  select claim.payout_id, claim.provider_destination_id
  from public.payout_claims claim
  where nullif(btrim(claim.provider_destination_id), '') is not null
  union all
  select tip_claim.payout_id,
    nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'), '')
  from public.tip_money_operation_claims tip_claim
  where nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'), '') is not null
), unambiguous as (
  select payout_id, min(provider_destination_id) as provider_destination_id
  from candidates
  group by payout_id
  having count(distinct provider_destination_id) = 1
)
select count(*) as candidate_rows
from public.payouts payout
join unambiguous on payout.id::text = unambiguous.payout_id
where payout.provider_destination_id is null;

-- C2 read-only source plan.
explain (format json)
with candidates as (
  select claim.payout_id, claim.provider_destination_id
  from public.payout_claims claim
  where nullif(btrim(claim.provider_destination_id), '') is not null
  union all
  select tip_claim.payout_id,
    nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'), '')
  from public.tip_money_operation_claims tip_claim
  where nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'), '') is not null
), unambiguous as (
  select payout_id, min(provider_destination_id) as provider_destination_id
  from candidates
  group by payout_id
  having count(distinct provider_destination_id) = 1
)
select payout.id
from public.payouts payout
join unambiguous on payout.id::text = unambiguous.payout_id
where payout.provider_destination_id is null;
