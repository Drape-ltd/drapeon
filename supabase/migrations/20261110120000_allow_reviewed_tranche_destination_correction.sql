CREATE OR REPLACE FUNCTION public.guard_claimed_replacement_against_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_payout public.payouts%rowtype;
  v_payment public.order_payments%rowtype;
  v_tranche public.order_settlement_tranches%rowtype;
  v_plan public.order_settlement_plans%rowtype;
begin
  if new.operation_number=1 then return new; end if;
  select * into v_claim from public.payout_claims where id=new.claim_id;
  if v_claim.id is null or v_claim.source_kind not in ('ORDER_EARNING','SETTLEMENT_TRANCHE')
    or v_claim.payout_id is null then
    raise exception 'Replacement funding route is not proven for this claim';
  end if;
  select * into v_payout from public.payouts where id::text=v_claim.payout_id;
  if v_payout.id is null or v_payout.source_payment_id is null then
    raise exception 'Replacement lacks its exact source payment';
  end if;

  -- Refund claim reservation takes order, payment, then claim. Do the same
  -- here before the existing operation validator locks the claim.
  perform 1 from public.orders where id_text=v_claim.order_id for update;
  if not found then raise exception 'Replacement order is missing'; end if;
  select * into v_payment from public.order_payments
    where id=v_payout.source_payment_id for update;
  select * into v_claim from public.payout_claims
    where id=new.claim_id for update;
  if v_claim.source_kind='SETTLEMENT_TRANCHE' then
    select * into v_tranche from public.order_settlement_tranches
      where id::text=v_claim.source_id and order_id=v_claim.order_id;
    select * into v_plan from public.order_settlement_plans
      where id=v_tranche.plan_id and order_id=v_claim.order_id;
    if v_payment.id is null or v_claim.id is null or v_tranche.id is null
      or v_plan.id is null or v_claim.status<>'FAILED_RECONCILED'
      or v_claim.transfer_status<>'FAILED_RECONCILED'
      or v_claim.provider_transfer_id is not null
      or v_payout.status<>'FAILED'
      or v_payout.payout_purpose<>'SETTLEMENT_TRANCHE'
      or v_payout.settlement_tranche_id is distinct from v_tranche.id
      or v_tranche.payout_id is distinct from v_payout.id::text
      or v_tranche.amount is distinct from v_claim.amount
      or v_tranche.currency is distinct from v_claim.currency
      or v_tranche.status not in ('BLOCKED','RELEASE_REQUESTED','ELIGIBLE')
      or v_plan.status<>'ACTIVE'
      or v_plan.currency is distinct from v_claim.currency
      or v_plan.source_payment_id is distinct from v_payment.id
      or v_payout.source_payment_id is distinct from v_payment.id
      or v_payout.order_id::text is distinct from v_claim.order_id
      or v_payout.tailor_profile_id::text is distinct from v_claim.tailor_profile_id
      or v_payout.provider::text is distinct from v_claim.provider
      or v_payout.currency is distinct from v_claim.currency
      or v_payout.amount is distinct from v_claim.amount
      or v_payment.order_id::text is distinct from v_claim.order_id
      or v_payment.provider::text is distinct from v_claim.provider
      or v_payment.currency is distinct from v_claim.currency
      or not payment_internal.tranche_source_payment_available(
        v_payment.id,v_plan.id,v_tranche.id)
      or not exists (select 1 from public.order_work_funding_positions pos
        where pos.payout_claim_id=v_claim.id and pos.use_kind='PAYOUT'
          and pos.source_payment_id=v_payment.id and pos.amount=v_claim.amount
          and pos.status='RESERVED') then
      raise exception 'Replacement tranche source or funding position is not available';
    end if;
    if exists (select 1 from public.order_payment_refund_claims r
        where r.payment_id=v_payment.id
          and r.status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING'))
      or exists (select 1 from public.disputes d
        where d.order_id::text=v_claim.order_id and d.status in ('OPEN','UNDER_REVIEW'))
      or exists (select 1 from public.provider_disputes d
        where d.order_id=v_claim.order_id and d.money_movement_blocked=true) then
      raise exception 'Replacement must wait for refund or dispute review';
    end if;
    return new;
  end if;
  if v_payment.id is null or v_claim.id is null
    or v_claim.status<>'BLOCKED'
    or v_payout.order_id::text is distinct from v_claim.order_id
    or v_payout.tailor_profile_id::text is distinct from v_claim.tailor_profile_id
    or v_payment.order_id::text is distinct from v_claim.order_id
    or v_payment.phase<>'INITIAL_ORDER'
    or v_payment.provider::text is distinct from v_claim.provider
    or v_payment.currency is distinct from v_claim.currency
    or v_payment.status<>'SUCCEEDED'
    or coalesce(v_payment.refunded_amount,0)>0 then
    raise exception 'Replacement source is not an unreimbursed accepted earning';
  end if;
  if exists (select 1 from public.order_payment_refund_claims r
      where r.payment_id=v_payment.id and r.status<>'FAILED_RECONCILED')
    or exists (select 1 from public.disputes d
      where d.order_id::text=v_claim.order_id and d.status in ('OPEN','UNDER_REVIEW'))
    or exists (select 1 from public.provider_disputes d
      where d.order_id=v_claim.order_id and d.money_movement_blocked=true) then
    raise exception 'Replacement must wait for refund or dispute review';
  end if;
  return new;
end $function$
