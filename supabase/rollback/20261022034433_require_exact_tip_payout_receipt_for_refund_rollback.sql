-- Restore the prior pending-receipt guard only while the exact-receipt version is installed.
do $$
begin
  if position('p.provider_payout_id=v_tip.payout_provider_reference' in
    pg_get_functiondef(
      'public.finalize_claimed_tip_refund(uuid,uuid,text)'::regprocedure
    ))=0 then
    raise exception 'Installed tip finalizer is not the expected exact-receipt version';
  end if;
end $$;

-- Finalize a provider-confirmed, fully journaled tip refund in one short transaction.
-- The provider request and journal are completed before this function is called.
create or replace function public.finalize_claimed_tip_refund(
  p_tip_id uuid,
  p_claim_id uuid,
  p_provider_refund_id text
)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_tip public.order_tips%rowtype;
  v_claim public.tip_money_operation_claims%rowtype;
  v_payment public.order_payments%rowtype;
begin
  if nullif(btrim(p_provider_refund_id), '') is null then
    raise exception 'Provider refund reference is required';
  end if;
  -- Match the reservation lock order: tip first, then claim.
  select * into v_tip from public.order_tips where id = p_tip_id for update;
  if v_tip.id is null or v_tip.payment_id is null then raise exception 'Tip payment is missing'; end if;
  select * into v_claim from public.tip_money_operation_claims
    where id = p_claim_id and tip_id = p_tip_id and operation_kind = 'REFUND' for update;
  if v_claim.id is null or v_claim.status <> 'SUCCEEDED'
    or v_claim.provider_operation_id is distinct from p_provider_refund_id then
    raise exception 'Tip refund claim lacks matching terminal provider evidence';
  end if;
  select * into v_payment from public.order_payments where id = v_tip.payment_id;
  if v_payment.id is null or v_payment.order_id <> v_tip.order_id or v_payment.phase <> 'TIP'
    or v_payment.status <> 'REFUNDED' or v_payment.amount <> v_tip.amount
    or v_payment.refunded_amount <> v_tip.amount or v_payment.currency <> v_tip.currency then
    raise exception 'Tip payment does not have an exact full refund';
  end if;
  if not exists (
    select 1 from public.commercial_ledger_transactions t
    where t.payment_id = v_payment.id and t.order_id = v_tip.order_id::text
      and t.transaction_kind = 'REFUND' and t.purpose = 'TIP'
      and t.provider_reference = p_provider_refund_id
  ) then
    raise exception 'Tip refund journal is missing';
  end if;
  -- The payout claim can confirm before its ledger/tip receipt is written.
  -- A post-payout refund must not close the tip first.
  if v_claim.refund_funding_mode = 'POST_PAYOUT'
    and (v_tip.payout_id is null or v_tip.ledger_transaction_id is null
      or nullif(btrim(v_tip.payout_provider_reference), '') is null) then
    return jsonb_build_object('outcome', 'PENDING_PAYOUT', 'tip_id', v_tip.id);
  end if;
  if v_tip.status = 'REFUNDED' then
    return jsonb_build_object('outcome', 'EXISTING', 'tip_id', v_tip.id);
  end if;
  update public.order_tips set status = 'REFUNDED', failure_reason = null, updated_at = now()
    where id = v_tip.id;
  insert into public.order_tip_events (tip_id, event_type, actor_role, payload, correlation_id)
    values (v_tip.id, 'TIP_REFUNDED', 'SYSTEM',
      jsonb_build_object('paymentId', v_payment.id, 'refundId', p_provider_refund_id,
        'claimId', v_claim.id, 'reviewed', true, 'fundingMode', v_claim.refund_funding_mode),
      v_tip.correlation_id);
  return jsonb_build_object('outcome', 'FINALIZED', 'tip_id', v_tip.id);
end;
$$;

revoke execute on function public.finalize_claimed_tip_refund(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.finalize_claimed_tip_refund(uuid,uuid,text) to service_role;
