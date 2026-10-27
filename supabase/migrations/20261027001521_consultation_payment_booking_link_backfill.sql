-- Link only when order, amount and currency identify exactly one paid
-- consultation booking. Charged historical rows that cannot be linked exactly
-- remain visible as Money Desk cases; do not guess from webhook metadata.

with matching_bookings as (
  select
    payment.id as payment_id,
    min(booking.id::text)::uuid as booking_id,
    count(distinct booking.id) as match_count
  from public.order_payments payment
  join public.consultation_bookings booking
    on booking.order_id::text = payment.order_id::text
   and booking.fee_mode = 'PAID'
   and booking.fee_amount = payment.amount
   and booking.fee_currency::text = payment.currency::text
  where payment.phase::text = 'CONSULTATION'
    and payment.consultation_booking_id is null
  group by payment.id
), linked as (
  update public.order_payments payment
  set consultation_booking_id = matching.booking_id,
      consultation_booking_link_source = 'BACKFILL'
  from matching_bookings matching
  where payment.id = matching.payment_id
    and matching.match_count = 1
  returning payment.id
)
select count(*) as exactly_linked_attempts from linked;

do $$
declare
  v_environment text := public.current_ops_environment();
  v_ambiguous_count integer;
begin
  select count(*) into v_ambiguous_count
  from (
    select payment.id
    from public.order_payments payment
    left join public.consultation_bookings booking
      on booking.order_id::text = payment.order_id::text
     and booking.fee_mode = 'PAID'
     and booking.fee_amount = payment.amount
     and booking.fee_currency::text = payment.currency::text
    where payment.phase::text = 'CONSULTATION'
      and payment.consultation_booking_id is null
      and payment.status::text in ('SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED')
    group by payment.id
    having count(distinct booking.id) <> 1
  ) ambiguous;

  if v_ambiguous_count > 0 and v_environment not in ('DEVELOPMENT', 'PRODUCTION') then
    raise exception 'Cannot create consultation payment-link cases without a known Ops environment.';
  end if;
end;
$$;

with ambiguous_attempts as (
  select
    payment.id as payment_id,
    payment.order_id::text as order_id,
    payment.provider::text as provider,
    payment.amount,
    payment.currency::text as currency,
    payment.status::text as payment_status,
    count(distinct booking.id) as match_count
  from public.order_payments payment
  left join public.consultation_bookings booking
    on booking.order_id::text = payment.order_id::text
   and booking.fee_mode = 'PAID'
   and booking.fee_amount = payment.amount
   and booking.fee_currency::text = payment.currency::text
  where payment.phase::text = 'CONSULTATION'
    and payment.consultation_booking_id is null
    and payment.status::text in ('SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED')
  group by payment.id, payment.order_id, payment.provider, payment.amount, payment.currency, payment.status
  having count(distinct booking.id) <> 1
), inserted_cases as (
  insert into public.ops_issues (
    issue_type, severity, status, source, related_entity_type, related_entity_id,
    provider, title, description, recommended_action, dedupe_key, metadata,
    queue_key, owning_team, priority, sensitivity, environment, canonical_status,
    first_response_due_at, active_resolution_due_at, sla_policy_version, provenance
  )
  select
    'PAYMENT_BLOCKED', 'HIGH', 'OPEN', 'consultation-payment-booking-backfill',
    'order_payment', attempt.payment_id::text,
    attempt.provider,
    'Consultation payment needs booking review',
    'A charged consultation payment could not be linked to exactly one booking using order, amount, and currency. No payout may be released from this attempt.',
    'Review the payment and booking evidence, link the exact booking through the reviewed Money Desk path, and then decide the refund or earning outcome. Do not infer the link from provider metadata.',
    'consultation-payment-booking-ambiguous:' || attempt.payment_id::text,
    jsonb_build_object(
      'payment_id', attempt.payment_id,
      'match_count', attempt.match_count,
      'payment_status', attempt.payment_status,
      'amount', attempt.amount,
      'currency', attempt.currency,
      'historical_backfill', true
    ),
    'money-desk', 'finance', 'P1', 'HIGHLY_RESTRICTED',
    public.current_ops_environment(), 'NEW',
    now() + interval '1 day', now() + interval '1 day',
    'money-desk-v1',
    case when public.current_ops_environment() = 'DEVELOPMENT' then 'QA' else 'REAL' end
  from ambiguous_attempts attempt
  on conflict (dedupe_key) do nothing
  returning id, dedupe_key, correlation_id
)
insert into public.ops_case_events (
  issue_id, event_type, visibility, sensitivity, actor_label,
  from_status, to_status, summary, payload, idempotency_key, correlation_id, occurred_at
)
select
  issue.id, 'STATE_TRANSITION', 'INTERNAL', 'HIGHLY_RESTRICTED',
  'migration/consultation-payment-booking-backfill', null, 'NEW',
  'Charged consultation payment entered review because its booking match was ambiguous or missing.',
  jsonb_build_object('paymentId', attempt.payment_id, 'matchCount', attempt.match_count, 'provider', attempt.provider),
  'consultation-payment-booking-case:' || attempt.payment_id::text,
  issue.correlation_id, now()
from ambiguous_attempts attempt
join public.ops_issues issue
  on issue.dedupe_key = 'consultation-payment-booking-ambiguous:' || attempt.payment_id::text
on conflict (issue_id, idempotency_key) do nothing;
