-- PAY-003 follow-up: reverse a provider-confirmed refund by immutable provider ID.
-- The refund claim is not authoritative here: Stripe can report an asynchronous
-- failure after the confirmed refund was already posted to the payment ledger.
drop function if exists public.reconcile_failed_order_payment_refund(uuid, text, jsonb);
create or replace function public.reconcile_failed_order_payment_refund(
  p_payment_id uuid,
  p_provider_refund_id text,
  p_failure_evidence jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.order_payments%rowtype;
  v_refund public.order_payment_provider_refunds%rowtype;
  v_confirmed_total integer;
  v_confirmed_count integer;
  v_next_status public.order_payment_status;
begin
  if p_payment_id is null
     or nullif(btrim(coalesce(p_provider_refund_id, '')), '') is null
     or nullif(btrim(coalesce(p_failure_evidence->>'failure_reason', '')), '') is null then
    raise exception 'REFUND_FAILURE_EVIDENCE_INVALID';
  end if;

  select * into v_payment from public.order_payments
  where id = p_payment_id for update;
  if v_payment.id is null then raise exception 'PAYMENT_NOT_FOUND'; end if;

  select * into v_refund from public.order_payment_provider_refunds
  where payment_id = v_payment.id
    and provider_refund_id = p_provider_refund_id
  for update;
  if v_refund.id is null or v_refund.status <> 'CONFIRMED' then
    raise exception 'CONFIRMED_REFUND_ROW_NOT_FOUND';
  end if;
  if coalesce(v_payment.refunded_amount, 0) < v_refund.amount
     or v_payment.status not in ('PARTIAL_REFUND', 'REFUNDED') then
    raise exception 'REFUND_FAILURE_POSITION_MISMATCH';
  end if;

  update public.order_payment_provider_refunds set
    status = 'FAILED',
    provider_response = coalesce(provider_response, '{}'::jsonb) || jsonb_build_object(
      'failure_evidence', p_failure_evidence
    ),
    updated_at = now()
  where id = v_refund.id;

  select coalesce(sum(amount), 0)::integer, count(*)::integer
    into v_confirmed_total, v_confirmed_count
  from public.order_payment_provider_refunds
  where payment_id = v_payment.id and status = 'CONFIRMED';

  if v_confirmed_total < 0 or v_confirmed_total > v_payment.amount then
    raise exception 'REFUND_FAILURE_AGGREGATE_INVALID';
  end if;
  v_next_status := case
    when v_confirmed_total = 0 then 'SUCCEEDED'::public.order_payment_status
    when v_confirmed_total = v_payment.amount then 'REFUNDED'::public.order_payment_status
    else 'PARTIAL_REFUND'::public.order_payment_status
  end;

  perform set_config('drape.payment_refund_failure', 'evidenced', true);
  update public.order_payments set
    refunded_amount = v_confirmed_total,
    partial_refund_count = v_confirmed_count,
    status = v_next_status,
    refunded_at = case when v_next_status = 'REFUNDED' then refunded_at else null end,
    provider_response = coalesce(provider_response, '{}'::jsonb) || jsonb_build_object(
      'failed_refund_reconciliation', jsonb_build_object(
        'provider_refund_id', p_provider_refund_id,
        'amount_reversed', v_refund.amount,
        'evidence', p_failure_evidence
      )
    )
  where id = v_payment.id
  returning * into v_payment;

  return to_jsonb(v_payment);
end;
$$;

revoke all on function public.reconcile_failed_order_payment_refund(uuid, text, jsonb)
from public, anon, authenticated;
grant execute on function public.reconcile_failed_order_payment_refund(uuid, text, jsonb)
to service_role;

comment on function public.reconcile_failed_order_payment_refund(uuid, text, jsonb)
is 'PAY-003: atomically removes one provider-confirmed refund by immutable provider refund ID after an evidenced terminal provider failure.';
