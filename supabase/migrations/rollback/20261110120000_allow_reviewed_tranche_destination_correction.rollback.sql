CREATE OR REPLACE FUNCTION public.guard_claimed_replacement_against_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_payout public.payouts%rowtype;
  v_payment public.order_payments%rowtype;
begin
  if new.operation_number=1 then return new; end if;
  select * into v_claim from public.payout_claims where id=new.claim_id;
  if v_claim.id is null or v_claim.source_kind<>'ORDER_EARNING'
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
