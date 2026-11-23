-- Dev-only QA receipt, after retrieving Stripe sandbox transfer
-- tr_1UUGk5CrvCJ1ybBB9LZhGPy7. This file never creates a transfer.
do $$
declare
  v_tip public.order_tips%rowtype;
  v_claim public.tip_money_operation_claims%rowtype;
  v_capture public.commercial_ledger_transactions%rowtype;
  v_payout public.commercial_ledger_transactions%rowtype;
  v_rejected boolean := false;
begin
  select * into v_tip from public.order_tips
    where id='20d65a1d-ce61-4c9f-a775-2e7159ccf4b0';
  select * into v_claim from public.tip_money_operation_claims
    where tip_id=v_tip.id and operation_kind='PAYOUT';
  select * into v_capture from public.commercial_ledger_transactions
    where id=v_tip.ledger_transaction_id;
  select * into v_payout from public.commercial_ledger_transactions
    where id=v_claim.payout_ledger_transaction_id;
  if v_tip.status<>'PAID_OUT' or v_claim.status<>'SUCCEEDED'
    or v_capture.id is null or v_payout.id is null
    or v_capture.id=v_payout.id or v_capture.purpose<>'TIP'
    or v_payout.purpose<>'TIP_PAYOUT'
    or v_claim.provider_operation_id is distinct from
      'tr_1UUGk5CrvCJ1ybBB9LZhGPy7'
    or v_payout.provider_reference is distinct from v_claim.provider_operation_id
    or (select count(*) from public.commercial_ledger_transactions
      where idempotency_key='tip-payout:'||v_tip.id::text)<>1 then
    raise exception 'Dev QA tip capture and payout receipt do not reconcile';
  end if;
  if has_function_privilege('authenticated',
    'public.finalize_claimed_stripe_tip_payout_core(uuid,uuid,text,text,jsonb)',
    'execute') then
    raise exception 'Tip payout finalizer is callable by authenticated users';
  end if;
  begin
    update public.tip_money_operation_claims
      set payout_ledger_transaction_id=null where id=v_claim.id;
  exception when others then
    v_rejected := position('cannot be rewritten' in sqlerrm)>0;
  end;
  if not v_rejected then
    raise exception 'Recorded tip payout ledger could be erased';
  end if;
end $$;
