-- A tip's ledger_transaction_id is its capture journal. The payout receipt
-- belongs to the durable payout claim, never to the captured tip row.
alter table public.tip_money_operation_claims
  add column payout_ledger_transaction_id uuid
  references public.commercial_ledger_transactions(id) on delete restrict;

alter table public.tip_money_operation_claims
  add constraint tip_payout_ledger_on_payout_claim_only check (
    payout_ledger_transaction_id is null or operation_kind='PAYOUT');

create unique index tip_money_payout_ledger_unique_idx
  on public.tip_money_operation_claims(payout_ledger_transaction_id)
  where payout_ledger_transaction_id is not null;

-- Preserve the existing provider, amount, source-payment and review checks in
-- the established finalizer. Every replacement below is asserted first, so a
-- changed upstream function fails migration rather than weakening the guard.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.finalize_claimed_stripe_tip_payout_core(uuid,uuid,text,text,jsonb)'::regprocedure)
    into v_definition;
  if position('if v_tip.ledger_transaction_id is not null' in v_definition)=0
    or position('if v_tip.ledger_transaction_id=v_ledger_id' in v_definition)=0
    or position('    ledger_transaction_id=v_ledger_id,' in v_definition)=0
    or position('  update public.payouts set status=' in v_definition)=0 then
    raise exception 'Tip payout core differs from the reviewed capture/payout collision';
  end if;
  v_definition := replace(v_definition,
    'v_tip.ledger_transaction_id', 'v_claim.payout_ledger_transaction_id');
  v_definition := replace(v_definition,
    '    ledger_transaction_id=v_ledger_id,' || chr(10), '');
  v_definition := replace(v_definition,
    '  update public.payouts set status=',
    '  update public.tip_money_operation_claims' || chr(10) ||
    '    set payout_ledger_transaction_id=v_ledger_id,updated_at=now()' || chr(10) ||
    '    where id=p_claim_id and (payout_ledger_transaction_id is null' || chr(10) ||
    '      or payout_ledger_transaction_id=v_ledger_id);' || chr(10) ||
    '  if not found then raise exception ''Tip claim payout journal conflicts''; end if;' || chr(10) ||
    '  update public.payouts set status=');
  execute v_definition;
end $$;

-- A post-payout refund needs the payout claim's exact journal, not the capture
-- journal. The captured tip remains immutable even after the tailor is paid.
create or replace function public.finalize_claimed_tip_refund(
  p_tip_id uuid, p_claim_id uuid, p_provider_refund_id text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_tip public.order_tips%rowtype;
  v_claim public.tip_money_operation_claims%rowtype;
  v_payment public.order_payments%rowtype;
begin
  if nullif(btrim(p_provider_refund_id),'') is null then
    raise exception 'Provider refund reference is required';
  end if;
  select * into v_tip from public.order_tips where id=p_tip_id for update;
  if v_tip.id is null or v_tip.payment_id is null then
    raise exception 'Tip payment is missing';
  end if;
  select * into v_claim from public.tip_money_operation_claims
    where id=p_claim_id and tip_id=p_tip_id and operation_kind='REFUND' for update;
  if v_claim.id is null or v_claim.status<>'SUCCEEDED'
    or v_claim.provider_operation_id is distinct from p_provider_refund_id then
    raise exception 'Tip refund claim lacks matching terminal provider evidence';
  end if;
  select * into v_payment from public.order_payments where id=v_tip.payment_id;
  if v_payment.id is null or v_payment.order_id<>v_tip.order_id
    or v_payment.phase<>'TIP' or v_payment.status<>'REFUNDED'
    or v_payment.amount<>v_tip.amount or v_payment.refunded_amount<>v_tip.amount
    or v_payment.currency<>v_tip.currency then
    raise exception 'Tip payment does not have an exact full refund';
  end if;
  if not exists (select 1 from public.commercial_ledger_transactions l
    where l.payment_id=v_payment.id and l.order_id=v_tip.order_id
      and l.transaction_kind='REFUND' and l.purpose='TIP'
      and l.provider_reference=p_provider_refund_id) then
    raise exception 'Tip refund journal is missing';
  end if;
  if v_claim.refund_funding_mode='POST_PAYOUT' and not exists (
    select 1 from public.tip_money_operation_claims payout_claim
    join public.payouts p on p.id=payout_claim.payout_id
    join public.commercial_ledger_transactions l
      on l.id=payout_claim.payout_ledger_transaction_id
    where payout_claim.tip_id=v_tip.id and payout_claim.operation_kind='PAYOUT'
      and payout_claim.status='SUCCEEDED'
      and payout_claim.provider_operation_id=v_tip.payout_provider_reference
      and p.id=v_tip.payout_id and p.order_id=v_tip.order_id
      and p.source_payment_id=v_tip.payment_id and p.payout_purpose='TIP'
      and p.amount=v_tip.amount and p.currency=v_tip.currency
      and p.provider_payout_id=v_tip.payout_provider_reference
      and l.payment_id=v_tip.payment_id and l.order_id=v_tip.order_id
      and l.purpose='TIP_PAYOUT'
      and l.provider_reference=v_tip.payout_provider_reference
  ) then
    return jsonb_build_object('outcome','PENDING_PAYOUT','tip_id',v_tip.id);
  end if;
  if v_tip.status='REFUNDED' then
    return jsonb_build_object('outcome','EXISTING','tip_id',v_tip.id);
  end if;
  update public.order_tips set status='REFUNDED',failure_reason=null,updated_at=now()
    where id=v_tip.id;
  insert into public.order_tip_events (tip_id,event_type,actor_role,payload,correlation_id)
    values (v_tip.id,'TIP_REFUNDED','SYSTEM',
      jsonb_build_object('paymentId',v_payment.id,'refundId',p_provider_refund_id,
        'claimId',v_claim.id,'reviewed',true,'fundingMode',v_claim.refund_funding_mode),
      v_tip.correlation_id);
  return jsonb_build_object('outcome','FINALIZED','tip_id',v_tip.id);
end $$;

-- The reconciler only considers a refund ready when that separate payout
-- journal exists. It still invokes the same exact-claim finalizer above.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.reconcile_confirmed_tip_refund_receipts(integer)'::regprocedure)
    into v_definition;
  if position('and t.ledger_transaction_id is not null' in v_definition)=0 then
    raise exception 'Tip refund reconciler differs from the reviewed receipt check';
  end if;
  v_definition := replace(v_definition,
    'and t.ledger_transaction_id is not null',
    'and exists (select 1 from public.tip_money_operation_claims pc' || chr(10) ||
    '        where pc.tip_id=t.id and pc.operation_kind=''PAYOUT''' || chr(10) ||
    '          and pc.payout_ledger_transaction_id is not null)');
  execute v_definition;
end $$;

revoke execute on function public.finalize_claimed_tip_refund(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.finalize_claimed_tip_refund(uuid,uuid,text)
  to service_role;
