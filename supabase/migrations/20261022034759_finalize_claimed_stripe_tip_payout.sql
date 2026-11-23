-- The Stripe transfer is verified and the claim is marked SUCCEEDED before this
-- short transaction. The provider is never called while these rows are locked.
create function public.finalize_claimed_stripe_tip_payout(
  p_tip_id uuid,
  p_claim_id uuid,
  p_payout_id text,
  p_provider_transfer_id text,
  p_provider_response jsonb
)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_tip public.order_tips%rowtype;
  v_claim public.tip_money_operation_claims%rowtype;
  v_payout public.payouts%rowtype;
  v_payment public.order_payments%rowtype;
  v_ledger_id uuid;
  v_review_needed boolean;
begin
  if nullif(btrim(p_provider_transfer_id),'') is null
    or p_provider_response is null
    or jsonb_typeof(p_provider_response)<>'object' then
    raise exception 'Confirmed Stripe tip transfer evidence is required';
  end if;
  -- Match the tip/refund reservation lock order.
  select * into v_tip from public.order_tips where id=p_tip_id for update;
  select * into v_claim from public.tip_money_operation_claims
    where id=p_claim_id and tip_id=p_tip_id and operation_kind='PAYOUT' for update;
  select * into v_payout from public.payouts where id=p_payout_id for update;
  if v_tip.id is null or v_claim.id is null or v_payout.id is null
    or v_claim.status<>'SUCCEEDED' or v_claim.provider::text<>'STRIPE'
    or v_claim.provider_operation_id is distinct from p_provider_transfer_id
    or v_claim.payout_id is distinct from p_payout_id
    or v_payout.payout_purpose<>'TIP'
    or v_payout.provider::text<>'STRIPE'
    or v_payout.order_id is distinct from v_tip.order_id
    or v_payout.source_payment_id is distinct from v_tip.payment_id
    or not exists (select 1 from public.tailor_profiles tp
      where tp.id=v_payout.tailor_profile_id
        and tp.user_id=v_tip.tailor_id::text)
    or v_payout.amount is distinct from v_tip.amount
    or v_payout.currency is distinct from v_tip.currency then
    raise exception 'Claimed tip payout does not match its confirmed Stripe transfer';
  end if;
  if v_payout.provider_payout_id is not null
    and v_payout.provider_payout_id is distinct from p_provider_transfer_id then
    raise exception 'Tip payout has a different provider transfer';
  end if;
  if (v_tip.payout_id is not null and v_tip.payout_id is distinct from p_payout_id)
    or (v_tip.payout_provider_reference is not null
      and v_tip.payout_provider_reference is distinct from p_provider_transfer_id) then
    raise exception 'Tip already points to a different payout';
  end if;
  select * into v_payment from public.order_payments where id=v_tip.payment_id;
  if v_payment.id is null or v_payment.order_id is distinct from v_tip.order_id
    or v_payment.phase<>'TIP' or v_payment.provider::text<>'STRIPE'
    or v_payment.amount is distinct from v_tip.amount
    or v_payment.currency is distinct from v_tip.currency
    or v_payment.status not in ('SUCCEEDED','REFUNDED') then
    raise exception 'Tip source payment is not a confirmed captured charge';
  end if;

  v_review_needed := v_payment.status<>'SUCCEEDED'
    or v_tip.status not in ('PAYOUT_PENDING','PROCESSING','PAID_OUT');
  v_ledger_id := public.post_commercial_ledger_transaction(
    'tip-payout:'||v_tip.id::text,'ADJUSTMENT','TIP_PAYOUT',
    v_tip.order_id,v_tip.payment_id,'benefits-2026-08-01-v1',1,
    v_tip.correlation_id,p_provider_transfer_id,
    jsonb_build_array(
      jsonb_build_object('accountCode','TIP_LIABILITY','accountScope','order',
        'direction','DEBIT','amount',v_tip.amount,'currency',v_tip.currency),
      jsonb_build_object('accountCode','TAILOR_RELEASED','accountScope',v_tip.order_id,
        'direction','CREDIT','amount',v_tip.amount,'currency',v_tip.currency)),
    jsonb_build_object('tip_id',v_tip.id,'payout_id',p_payout_id),
    null,null,'SYSTEM',v_tip.currency,v_tip.amount,
    v_tip.currency,v_tip.amount,1,0
  );
  if v_tip.ledger_transaction_id is not null
    and v_tip.ledger_transaction_id is distinct from v_ledger_id then
    raise exception 'Tip already points to a different payout journal';
  end if;
  if v_tip.ledger_transaction_id=v_ledger_id
    and v_tip.payout_id=p_payout_id
    and v_tip.payout_provider_reference=p_provider_transfer_id then
    return jsonb_build_object('outcome','EXISTING','tip_id',v_tip.id,
      'payout_id',p_payout_id,'ledger_id',v_ledger_id,
      'provider_transfer_id',p_provider_transfer_id,
      'review_needed',v_review_needed);
  end if;
  update public.payouts set status='PROCESSING',
    provider_payout_id=p_provider_transfer_id,
    provider_transfer_status='AVAILABLE_IN_PROVIDER_BALANCE',
    bank_settlement_status='PENDING',
    provider_response=p_provider_response
    where id=p_payout_id;
  update public.order_tips set
    status=case when status in ('PAYOUT_PENDING','PROCESSING','PAID_OUT')
      then 'PAID_OUT' else status end,
    payout_id=p_payout_id,
    payout_provider_reference=p_provider_transfer_id,
    ledger_transaction_id=v_ledger_id,
    paid_out_at=coalesce(paid_out_at,now()),
    failure_reason=null,updated_at=now()
    where id=v_tip.id;
  if not exists (select 1 from public.order_tip_events
    where tip_id=v_tip.id and event_type='TIP_PAID_OUT'
      and payload->>'provider_reference'=p_provider_transfer_id) then
    insert into public.order_tip_events (
      tip_id,event_type,actor_role,payload,correlation_id
    ) values (
      v_tip.id,'TIP_PAID_OUT','SYSTEM',
      jsonb_build_object('payout_id',p_payout_id,'provider','STRIPE',
        'provider_reference',p_provider_transfer_id,'review_needed',v_review_needed),
      v_tip.correlation_id
    );
  end if;
  if v_review_needed then
    insert into public.ops_issues (
      issue_type,severity,status,source,order_id,related_entity_type,
      related_entity_id,provider,title,description,recommended_action,
      dedupe_key,metadata
    ) values (
      'PAYOUT_LATE_SUCCESS','HIGH','OPEN','claimed-tip-payout',
      v_tip.order_id,'ORDER_TIP',v_tip.id::text,'STRIPE',
      'Tip transfer confirmed during a refund or hold',
      'Stripe confirmed the tailor transfer while the tip payment or tip state changed. The real payout was recorded without overwriting the refund or hold.',
      'Reconcile the captured charge, reviewed refund, tailor receipt, and Money Desk case.',
      'tip-payout-review:'||v_tip.id::text,
      jsonb_build_object('tip_id',v_tip.id,'payout_id',p_payout_id,
        'claim_id',p_claim_id,'provider_transfer_id',p_provider_transfer_id,
        'payment_status',v_payment.status,'prior_tip_status',v_tip.status)
    ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now();
  end if;
  return jsonb_build_object('outcome','COMPLETED','tip_id',v_tip.id,
    'payout_id',p_payout_id,'ledger_id',v_ledger_id,
    'provider_transfer_id',p_provider_transfer_id,
    'review_needed',v_review_needed);
end $$;

revoke execute on function public.finalize_claimed_stripe_tip_payout(
  uuid,uuid,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.finalize_claimed_stripe_tip_payout(
  uuid,uuid,text,text,jsonb
) to service_role;
