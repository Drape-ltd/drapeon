-- Restore Phase 1 dependency functions with Production UUID/text bridges.
-- Money Edge deployment remains gated on trigger and runtime verification.

CREATE OR REPLACE FUNCTION payment_internal.assert_order_payout_policy(p_order_id text, p_kind text, p_source_id text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_policy text;
  v_plan_count integer;
begin
  if p_kind not in ('ORDER_EARNING','SETTLEMENT_TRANCHE','RESIDUAL_SETTLEMENT') then
    raise exception 'Unsupported order payout kind';
  end if;
  select commercial_policy_version into v_policy
    from public.orders where id_text=p_order_id for update;
  if not found or v_policy is null then
    raise exception 'Order payout policy is missing; Money Desk review required';
  end if;
  select count(*) into v_plan_count from public.order_settlement_plans
    where order_id=p_order_id;

  if v_policy='commercial-2026-07-31-v1' then
    if v_plan_count<>1 then
      raise exception 'Staged order is missing its accepted plan';
    end if;
    if exists (select 1 from public.payout_claims
        where order_id=p_order_id and source_kind='ORDER_EARNING')
      or exists (select 1 from public.payouts
        where order_id::text=p_order_id and payout_purpose='ORDER_EARNING') then
      raise exception 'Staged order has an ordinary earning release; Money Desk review required';
    end if;
    if p_kind='SETTLEMENT_TRANCHE' then
      if not exists (select 1 from public.order_settlement_plans plan
          join public.order_settlement_tranches tranche on tranche.plan_id=plan.id
          where plan.order_id=p_order_id
            and plan.policy_version='settlement-2026-08-01-v1'
            and tranche.id::text=p_source_id)
        or exists (select 1 from public.payout_claims
          where order_id=p_order_id and source_kind='RESIDUAL_SETTLEMENT')
        or exists (select 1 from public.payouts
          where order_id::text=p_order_id and payout_purpose='RESIDUAL_SETTLEMENT') then
        raise exception 'Staged tranche conflicts with a residual settlement; Money Desk review required';
      end if;
    elsif p_kind='RESIDUAL_SETTLEMENT' then
      if p_source_id is distinct from p_order_id
        or not exists (select 1 from public.order_settlement_plans
          where order_id=p_order_id and policy_version='settlement-2026-08-01-v1')
        or exists (select 1 from public.order_settlement_tranches
          where order_id=p_order_id and status not in ('RELEASED','CANCELLED')) then
        raise exception 'Staged residual requires terminal tranches and its exact order';
      end if;
    else
      raise exception 'Staged order requires its exact snapshotted tranche or reviewed residual';
    end if;
  elsif v_policy='legacy-single-release-72h' then
    if p_kind<>'ORDER_EARNING' or v_plan_count<>0
      or exists (select 1 from public.payout_claims
        where order_id=p_order_id and source_kind in ('SETTLEMENT_TRANCHE','RESIDUAL_SETTLEMENT'))
      or exists (select 1 from public.payouts
        where order_id::text=p_order_id and payout_purpose in ('SETTLEMENT_TRANCHE','RESIDUAL_SETTLEMENT')) then
      raise exception 'Legacy order conflicts with staged settlement; Money Desk review required';
    end if;
  else
    raise exception 'Order payout policy is unrecognized; Money Desk review required';
  end if;
end $function$;
REVOKE ALL ON FUNCTION payment_internal.assert_order_payout_policy(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION payment_internal.assert_order_payout_policy(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION payment_internal.ensure_order_work_funding_source(p_payment_id uuid, p_plan_id uuid, p_refund_claim_id uuid DEFAULT NULL::uuid, p_payout_claim_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.order_settlement_plans%rowtype;
  v_payment public.order_payments%rowtype;
  v_source public.order_work_funding_sources%rowtype;
begin
  select * into v_plan from public.order_settlement_plans where id=p_plan_id;
  select * into v_payment from public.order_payments where id=p_payment_id for update;
  if v_plan.id is null or v_payment.id is null
    or v_plan.source_payment_id is distinct from v_payment.id
    or v_plan.order_id is distinct from v_payment.order_id::text
    or v_payment.phase<>'INITIAL_ORDER'
    or v_payment.status not in ('SUCCEEDED','PARTIAL_REFUND')
    or v_payment.ledger_recorded_at is null then
    raise exception 'Staged work source has no matching captured payment';
  end if;
  select * into v_source from public.order_work_funding_sources
    where payment_id=p_payment_id for update;
  if exists (select 1 from public.payout_claims pc
      join public.order_settlement_tranches tr on tr.id::text=pc.source_id
      where pc.source_kind='SETTLEMENT_TRANCHE' and tr.plan_id=p_plan_id
        and pc.id is distinct from p_payout_claim_id
        and not exists (select 1 from public.order_work_funding_positions pos
          where pos.payout_claim_id=pc.id))
    or exists (select 1 from public.order_payment_refund_claims rc
      where rc.payment_id=p_payment_id and rc.id is distinct from p_refund_claim_id
        and not exists (select 1 from public.order_work_funding_positions pos
          where pos.refund_claim_id=rc.id)) then
    raise exception 'Unpositioned staged work claim requires Money Desk reconciliation';
  end if;
  if v_source.payment_id is null then
    -- Never assign old, untracked money to a fresh charge position by guesswork.
    if coalesce(v_payment.refunded_amount,0)<>0
      or exists (select 1 from public.payouts
        where source_payment_id=p_payment_id
          and payout_purpose in ('ORDER_EARNING','SETTLEMENT_TRANCHE'))
      or exists (select 1 from public.order_payment_refund_claims
        where payment_id=p_payment_id and id is distinct from p_refund_claim_id) then
      raise exception 'Historical work funding requires Money Desk reconciliation';
    end if;
    insert into public.order_work_funding_sources (
      payment_id,plan_id,order_id,currency,captured_tailor_amount
    ) values (
      v_payment.id,v_plan.id,v_plan.order_id,v_plan.currency,v_plan.entitlement_amount
    ) on conflict (payment_id) do nothing;
    select * into v_source from public.order_work_funding_sources
      where payment_id=p_payment_id for update;
  end if;
  if v_source.plan_id is distinct from v_plan.id
    or v_source.order_id is distinct from v_plan.order_id
    or v_source.currency is distinct from v_plan.currency
    or v_source.captured_tailor_amount is distinct from v_plan.entitlement_amount then
    raise exception 'Staged work source identity changed';
  end if;
end $function$;
REVOKE ALL ON FUNCTION payment_internal.ensure_order_work_funding_source(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_staged_residual_settlement(p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order public.orders%rowtype;
  v_plan public.order_settlement_plans%rowtype;
  v_payment public.order_payments%rowtype;
  v_resolution public.order_refund_resolutions%rowtype;
  v_tranche_count integer;
  v_expected_count integer;
  v_planned_amount bigint;
  v_released_amount bigint;
  v_refunded_work bigint;
  v_capture_credit bigint;
  v_residual bigint;
begin
  select * into v_order from public.orders where id_text=p_order_id;
  if not found or v_order.commercial_policy_version is distinct from 'commercial-2026-07-31-v1'
    or v_order.stage::text<>'COMPLETE' then
    raise exception 'A completed staged-policy order is required for residual review';
  end if;
  select * into v_plan from public.order_settlement_plans where order_id=p_order_id;
  if not found or v_plan.policy_version<>'settlement-2026-08-01-v1'
    or v_plan.status not in ('ACTIVE','FROZEN')
    or v_plan.entitlement_amount<=0 then
    raise exception 'The accepted staged settlement plan is missing or closed';
  end if;
  select * into v_payment from public.order_payments
    where id=v_plan.source_payment_id and order_id::text=p_order_id;
  if not found or v_payment.phase<>'INITIAL_ORDER'
    or v_payment.status not in ('SUCCEEDED','PARTIAL_REFUND')
    or v_payment.ledger_recorded_at is null
    or v_payment.currency is distinct from v_plan.currency then
    raise exception 'A ledger-recorded initial payment matching the plan is required';
  end if;
  select * into v_resolution from public.order_refund_resolutions
    where order_id=p_order_id and status='SUCCEEDED'
      and coalesce(reviewed_order_outcome,order_outcome)='CLOSE_ORDER'
      and coalesce(reviewed_outcome_applied_at,outcome_applied_at) is not null
    order by coalesce(reviewed_outcome_applied_at,outcome_applied_at) desc,updated_at desc
    limit 1;
  if not found then
    raise exception 'A completed close-order refund decision is required';
  end if;
  if exists (select 1 from public.disputes
      where order_id::text=p_order_id and status in ('OPEN','UNDER_REVIEW')) then
    raise exception 'An open dispute blocks staged residual review';
  end if;
  if exists (select 1 from public.payout_claims
      where order_id=p_order_id and source_kind='ORDER_EARNING')
    or exists (select 1 from public.payouts
      where order_id::text=p_order_id and payout_purpose='ORDER_EARNING') then
    raise exception 'An ordinary earning payout conflicts with staged settlement';
  end if;
  if exists (select 1 from public.payout_claims
      where order_id=p_order_id and source_kind='RESIDUAL_SETTLEMENT') then
    raise exception 'An existing residual claim needs Money Desk reconciliation';
  end if;

  select coalesce(sum(case when e.direction='CREDIT' then e.amount else -e.amount end),0)
    into v_capture_credit
    from public.commercial_ledger_transactions tx
    join public.commercial_ledger_entries e on e.transaction_id=tx.id
    where tx.payment_id=v_payment.id and tx.transaction_kind='CAPTURE'
      and e.account_code='TAILOR_ENTITLEMENT';
  if v_capture_credit is distinct from v_plan.entitlement_amount then
    raise exception 'The captured tailor allocation differs from the accepted plan';
  end if;

  v_expected_count := case v_plan.method
    when 'SHIPPED' then 3 when 'LOCAL_HANDOFF' then 2 else 0 end;
  select count(*),coalesce(sum(amount),0),
      coalesce(sum(amount) filter (where status='RELEASED'),0)
    into v_tranche_count,v_planned_amount,v_released_amount
    from public.order_settlement_tranches
    where plan_id=v_plan.id and order_id=p_order_id;
  if v_tranche_count<>v_expected_count
    or v_planned_amount is distinct from v_plan.entitlement_amount then
    raise exception 'The staged tranches do not equal the accepted tailor allocation';
  end if;
  if exists (select 1 from public.order_settlement_tranches t
      where t.plan_id=v_plan.id and (
        t.status='RELEASE_REQUESTED'
        or (t.status='RELEASED' and (
          t.payout_id is null or t.release_ledger_transaction_id is null
          or nullif(btrim(t.provider_reference),'') is null))
        or (t.status<>'RELEASED' and (
          t.payout_id is not null or exists (
            select 1 from public.payout_claims c
            where c.source_kind='SETTLEMENT_TRANCHE' and c.source_id=t.id::text
          )))
      )) then
    raise exception 'A tranche transfer or unresolved claim needs Money Desk reconciliation';
  end if;

  -- Count a RELEASED tranche only with a matching immutable claim, terminal
  -- provider attempt, payout row and release journal. Historical optimistic
  -- labels without these receipts remain Money Desk cases, not residual inputs.
  if exists (select 1 from public.order_settlement_tranches t
      where t.plan_id=v_plan.id and t.status='RELEASED'
        and not exists (
          select 1 from public.payout_claims c
          join public.payouts p on p.id::text=c.payout_id
          join public.payout_attempts a on a.claim_id=c.id
          join public.commercial_ledger_transactions tx
            on tx.id=t.release_ledger_transaction_id
          where c.source_kind='SETTLEMENT_TRANCHE'
            and c.source_id=t.id::text and c.order_id=p_order_id
            and c.earning_policy_version=v_plan.policy_version
            and c.status in ('TRANSFERRED','WITHDRAWN')
            and c.transfer_status='CONFIRMED'
            and c.provider_transfer_id=t.provider_reference
            and c.amount=t.amount and c.currency=t.currency
            and p.id::text=t.payout_id::text and p.order_id::text=p_order_id
            and p.settlement_tranche_id=t.id
            and p.source_payment_id=v_payment.id
            and p.provider::text=c.provider
            and p.provider_payout_id=t.provider_reference
            and p.amount=t.amount and p.currency=t.currency
            and a.status='SUCCEEDED'
            and a.provider_operation_id=t.provider_reference
            and tx.order_id=p_order_id
            and tx.payment_id=v_payment.id
            and tx.purpose='SETTLEMENT_RELEASE'
            and tx.provider_reference=t.provider_reference
            and tx.original_amount=t.amount
            and tx.original_currency=t.currency
        )) then
    raise exception 'A released tranche lacks its provider-confirmed claim and ledger receipt';
  end if;

  select coalesce(sum(tailor_work_amount),0) into v_refunded_work
    from public.order_refund_resolutions
    where order_id=p_order_id and status='SUCCEEDED';
  v_residual := v_plan.entitlement_amount::bigint-v_refunded_work-v_released_amount;
  if v_refunded_work<0 or v_residual<0 then
    raise exception 'Refunded work and released tranches exceed the accepted allocation';
  end if;
  return jsonb_build_object(
    'policyVersion','staged-residual-review-v1',
    'orderId',p_order_id,'planId',v_plan.id,
    'sourcePaymentId',v_payment.id,'refundResolutionId',v_resolution.id,
    'currency',v_plan.currency,'provider',v_payment.provider,
    'originalTailorAllocation',v_plan.entitlement_amount,
    'refundedTailorWork',v_refunded_work,
    'releasedTranches',v_released_amount,
    'residualTailorEntitlement',v_residual,
    'requiresPayout',v_residual>0
  );
end $function$;
REVOKE ALL ON FUNCTION public.preview_staged_residual_settlement(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_staged_residual_settlement(text) TO service_role;

CREATE OR REPLACE FUNCTION public.tailor_adjustment_release_gate(p_adjustment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_adjustment public.commercial_adjustments%rowtype;
  v_payment public.order_payments%rowtype;
  v_plan public.order_settlement_plans%rowtype;
  v_evidence public.order_settlement_evidence%rowtype;
  v_prior_evidence boolean;
  v_open_review boolean;
  v_eligible_at timestamptz;
begin
  select * into v_adjustment
    from public.commercial_adjustments where id=p_adjustment_id;
  if v_adjustment.id is null then
    return jsonb_build_object('state','NOT_FOUND');
  end if;
  if v_adjustment.tailor_release_policy_version is distinct from
      'tailor-adjustment-delivery-72h-reviewed-v1' then
    return jsonb_build_object('state','UNSUPPORTED_POLICY');
  end if;
  if v_adjustment.status not in ('PAID','COMPLETED')
    or v_adjustment.decided_at is null or v_adjustment.payment_id is null then
    return jsonb_build_object('state','WAITING_PAYMENT');
  end if;

  select * into v_payment from public.order_payments
    where id=v_adjustment.payment_id;
  if v_payment.id is null
    or v_payment.order_id::text <> v_adjustment.order_id
    or v_payment.phase::text <> 'ADJUSTMENT'
    or v_payment.currency is distinct from v_adjustment.currency
    or v_payment.status::text <> 'SUCCEEDED'
    or v_payment.amount < v_adjustment.amount_delta
    or v_payment.provider_payment_id is null
    or v_payment.ledger_recorded_at is null
    or v_payment.confirmed_at is null then
    return jsonb_build_object('state','WAITING_PAYMENT');
  end if;
  if coalesce(v_payment.refunded_amount,0) > 0 then
    return jsonb_build_object('state','BLOCKED_REFUND');
  end if;

  select * into v_plan from public.order_settlement_plans
    where order_id=v_adjustment.order_id;
  if v_plan.id is null or v_plan.policy_version <> 'settlement-2026-08-01-v1'
    or v_plan.currency is distinct from v_adjustment.currency then
    return jsonb_build_object('state','NO_PROVEN_SETTLEMENT_PLAN');
  end if;
  if v_plan.status not in ('ACTIVE','SETTLED') then
    return jsonb_build_object('state','BLOCKED_REVIEW');
  end if;

  select exists (
    select 1 from public.disputes d where d.order_id::text=v_adjustment.order_id
      and d.status::text in ('OPEN','UNDER_REVIEW')
  ) or exists (
    select 1 from public.provider_disputes d
      where d.order_id=v_adjustment.order_id and d.money_movement_blocked
  ) or exists (
    select 1 from public.financial_cases c
      where c.order_id=v_adjustment.order_id
        and c.status not in ('RESOLVED','CLOSED','CANCELLED')
  ) or exists (
    select 1 from public.order_payment_refund_claims r
      where r.order_id=v_adjustment.order_id
        and r.status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING')
  ) into v_open_review;
  if v_open_review then
    return jsonb_build_object('state','BLOCKED_REVIEW');
  end if;

  -- The ordinary order receipt is usable only if it follows acceptance.
  -- A post-delivery alteration cannot reuse the original garment receipt.
  select * into v_evidence from public.order_settlement_evidence e
    where e.plan_id=v_plan.id
      and e.occurred_at >= v_adjustment.decided_at
      and e.evidence_kind = case v_plan.method
        when 'SHIPPED' then 'VERIFIED_DELIVERY'
        when 'LOCAL_HANDOFF' then 'AUTHENTICATED_LOCAL_HANDOFF'
        else 'UNSUPPORTED' end
      and ((e.evidence_kind='VERIFIED_DELIVERY'
             and e.source in ('TRUSTED_CARRIER','CUSTOMER_CONFIRMATION','DRAPEON_OPS'))
        or (e.evidence_kind='AUTHENTICATED_LOCAL_HANDOFF'
             and e.source='COLLECTION_CODE'))
    order by e.occurred_at, e.id limit 1;
  if v_evidence.id is null then
    select exists (select 1 from public.order_settlement_evidence e
      where e.plan_id=v_plan.id
        and e.evidence_kind in ('VERIFIED_DELIVERY','AUTHENTICATED_LOCAL_HANDOFF')
        and e.occurred_at < v_adjustment.decided_at)
      into v_prior_evidence;
    return jsonb_build_object('state',case when v_prior_evidence
      then 'NEEDS_ADJUSTMENT_HANDOFF' else 'WAITING_DELIVERY' end);
  end if;

  v_eligible_at := greatest(v_evidence.occurred_at + interval '72 hours',
    v_payment.confirmed_at);
  return jsonb_build_object(
    'state',case when now() < v_eligible_at then 'WAITING_72H'
      else 'READY_FOR_MONEY_DESK' end,
    'eligible_at',v_eligible_at,
    'evidence_id',v_evidence.id,
    'payment_id',v_payment.id,
    'review_required',true);
end;
$function$;
REVOKE ALL ON FUNCTION public.tailor_adjustment_release_gate(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tailor_adjustment_release_gate(uuid) TO service_role;
