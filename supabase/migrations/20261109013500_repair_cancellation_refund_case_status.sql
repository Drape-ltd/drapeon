-- Data-only repair: close canonical cancellation-review cases only when the
-- refunded order and a succeeded, case-bound Money Desk request prove closure.
-- Dev preview on 2026-11-09: exactly one eligible row. Do not infer Prod count.
with eligible as materialized (
  select
    issue.id,
    issue.canonical_status as previous_canonical_status,
    issue.sensitivity,
    coalesce(issue.correlation_id, money.correlation_id, gen_random_uuid()) as correlation_id,
    money.id as money_desk_request_id
  from public.ops_issues issue
  join public.orders order_row
    on order_row.id::text = issue.order_id::text
   and order_row.stage::text = 'REFUNDED'
  join lateral (
    select request.id, request.correlation_id
    from public.money_desk_requests request
    where request.status = 'SUCCEEDED'
      and request.action_type = 'CUSTOMER_REFUND'
      and request.target_type = 'ORDER_CANCELLATION'
      and request.action_payload->>'reviewIssueId' = issue.id::text
      and request.order_id = issue.order_id::text
    order by request.updated_at desc nulls last, request.id
    limit 1
  ) money on true
  where issue.issue_type = 'ORDER_REVIEW'
    and issue.metadata->>'review_type' = 'CANCELLATION'
    and issue.status = 'RESOLVED'
    and issue.canonical_status = 'NEW'
    and issue.resolved_at is not null
    and not exists (
      select 1 from public.ops_job_recoveries recovery
      where recovery.issue_id = issue.id and recovery.outcome = 'PENDING'
    )
  for update of issue
), repaired as (
  update public.ops_issues issue
  set canonical_status = 'RESOLVED'
  from eligible
  where issue.id = eligible.id
  returning issue.id, issue.sensitivity, eligible.previous_canonical_status,
    eligible.correlation_id, eligible.money_desk_request_id
)
insert into public.ops_case_events (
  issue_id, event_type, visibility, sensitivity, actor_label,
  from_status, to_status, summary, payload, idempotency_key,
  correlation_id, occurred_at
)
select repaired.id, 'STATE_TRANSITION', 'INTERNAL', repaired.sensitivity,
  'system migration', repaired.previous_canonical_status, 'RESOLVED',
  'Canonical cancellation review status reconciled with completed refund.',
  jsonb_build_object('moneyDeskRequestId', repaired.money_desk_request_id),
  'cancellation-refund-case-repair:' || repaired.money_desk_request_id::text,
  repaired.correlation_id, now()
from repaired
on conflict (issue_id, idempotency_key) do nothing;
