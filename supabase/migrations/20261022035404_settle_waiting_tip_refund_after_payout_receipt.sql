-- Keep the verified Stripe payout receipt as the first transaction step. Once
-- it is durable, close an already provider-confirmed, fully journaled refund
-- that had been waiting for that exact receipt. No provider call occurs here.
alter function public.finalize_claimed_stripe_tip_payout(uuid,uuid,text,text,jsonb)
  rename to finalize_claimed_stripe_tip_payout_core;

create function public.finalize_claimed_stripe_tip_payout(
  p_tip_id uuid,
  p_claim_id uuid,
  p_payout_id text,
  p_provider_transfer_id text,
  p_provider_response jsonb
)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_receipt jsonb;
  v_refund public.tip_money_operation_claims%rowtype;
  v_tip public.order_tips%rowtype;
  v_payment public.order_payments%rowtype;
begin
  v_receipt := public.finalize_claimed_stripe_tip_payout_core(
    p_tip_id,p_claim_id,p_payout_id,p_provider_transfer_id,p_provider_response);
  select * into v_refund from public.tip_money_operation_claims
    where tip_id=p_tip_id and operation_kind='REFUND' and status='SUCCEEDED';
  if v_refund.id is null or v_refund.refund_funding_mode<>'POST_PAYOUT'
    or nullif(btrim(v_refund.provider_operation_id),'') is null then
    return v_receipt;
  end if;
  select * into v_tip from public.order_tips where id=p_tip_id;
  select * into v_payment from public.order_payments where id=v_tip.payment_id;
  if v_payment.status<>'REFUNDED' or v_payment.refunded_amount<>v_tip.amount
    or not exists (select 1 from public.commercial_ledger_transactions l
      where l.payment_id=v_tip.payment_id and l.order_id=v_tip.order_id
        and l.transaction_kind='REFUND' and l.purpose='TIP'
        and l.provider_reference=v_refund.provider_operation_id) then
    return v_receipt;
  end if;
  begin
    perform public.finalize_claimed_tip_refund(
      p_tip_id,v_refund.id,v_refund.provider_operation_id);
    return v_receipt || jsonb_build_object('waiting_refund_finalized',true);
  exception when others then
    -- A real confirmed transfer must not disappear because refund bookkeeping
    -- needs repair. Preserve the payout receipt and queue the exact claim.
    insert into public.ops_issues (
      issue_type,severity,status,source,order_id,related_entity_type,
      related_entity_id,provider,title,description,recommended_action,
      dedupe_key,metadata
    ) values (
      'REFUND_FAILED','HIGH','OPEN','claimed-tip-payout-refund-repair',
      v_tip.order_id,'ORDER_TIP',p_tip_id::text,'STRIPE',
      'Confirmed tip refund needs final reconciliation',
      'The payout receipt was recorded, but a provider-confirmed full tip refund could not be finalized.',
      'Review the exact payout and refund claims and retry finalization without creating another provider refund.',
      'tip-refund-repair:'||p_tip_id::text,
      jsonb_build_object('tip_id',p_tip_id,'refund_claim_id',v_refund.id,
        'payout_claim_id',p_claim_id,'provider_refund_id',v_refund.provider_operation_id,
        'error',sqlerrm)
    ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now();
    return v_receipt || jsonb_build_object('waiting_refund_finalized',false);
  end;
end $$;

revoke execute on function public.finalize_claimed_stripe_tip_payout(
  uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_claimed_stripe_tip_payout(
  uuid,uuid,text,text,jsonb) to service_role;
revoke execute on function public.finalize_claimed_stripe_tip_payout_core(
  uuid,uuid,text,text,jsonb) from public,anon,authenticated;
