-- PAY-003 data-only forward baseline. The reviewed 2026-11-18 Dev count is
-- zero. A later Production preflight must also return zero; any nonzero
-- candidate needs a new reviewed data plan rather than an implicit backfill.
do $baseline$
declare
  v_candidates integer;
  v_inserted integer;
begin
  select count(*) into v_candidates from public.order_payments payment
  where coalesce(payment.refunded_amount,0)>0
    and not exists (select 1 from public.order_payment_provider_refunds r
      where r.payment_id=payment.id);
  if v_candidates <> 0 then
    raise exception 'PAY003_BASELINE_REQUIRES_ROW_REVIEW:%',v_candidates;
  end if;
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
  get diagnostics v_inserted = row_count;
  if v_inserted <> 0 then
    raise exception 'PAY003_BASELINE_CHANGED_DURING_APPLY:%',v_inserted;
  end if;
end;
$baseline$;
