-- PAY-003: seed the provider-refund aggregate for payments refunded before
-- order_payment_provider_refunds existed. This is intentionally data-only so
-- the affected-row count is independently reviewable during each rollout.
insert into public.order_payment_provider_refunds (
  payment_id,
  provider,
  provider_refund_id,
  amount,
  status,
  provider_response
)
select
  payment.id,
  payment.provider,
  'LEGACY-' || payment.id::text,
  payment.refunded_amount,
  'CONFIRMED',
  jsonb_build_object(
    'source', 'PAY003_LEGACY_BASELINE',
    'backfilled_at', now(),
    'payment_status', payment.status
  )
from public.order_payments payment
where coalesce(payment.refunded_amount, 0) > 0
  and not exists (
    select 1
    from public.order_payment_provider_refunds provider_refund
    where provider_refund.payment_id = payment.id
  )
on conflict (provider, provider_refund_id) do nothing;

