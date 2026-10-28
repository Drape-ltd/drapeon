-- Forward-only restoration of payout claim guards missing from Production's
-- pre-Phase-2 migration history. Definitions derive from the final Dev catalog and adapt native UUID
-- order/payment IDs through text bridges; each function's origin was located on the isolated Phase 1 branch.
-- Money Edge deployment remains blocked until the bindings migration passes.

-- payment_internal.confirm_order_work_payout_from_claim
CREATE OR REPLACE FUNCTION payment_internal.confirm_order_work_payout_from_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.source_kind in ('SETTLEMENT_TRANCHE','RESIDUAL_SETTLEMENT')
    and new.status in ('TRANSFERRED','WITHDRAWN')
    and new.transfer_status='CONFIRMED'
    and nullif(btrim(new.provider_transfer_id),'') is not null then
    update public.order_work_funding_positions set status='PAYOUT_CONFIRMED'
      where payout_claim_id=new.id and use_kind='PAYOUT' and status='RESERVED';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION payment_internal.confirm_order_work_payout_from_claim() FROM PUBLIC, anon, authenticated, service_role;

-- payment_internal.guard_new_order_earning_claim_eligibility
CREATE OR REPLACE FUNCTION payment_internal.guard_new_order_earning_claim_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_amount integer;
  v_destination text;
begin
  if new.source_kind <> 'ORDER_EARNING' then return new; end if;
  select * into v_order from public.orders where id_text=new.order_id for update;
  if not found or new.source_id is distinct from new.order_id
    or v_order.commercial_policy_version is distinct from 'legacy-single-release-72h'
    or v_order.stage::text not in ('DELIVERED','COLLECTED','COMPLETE')
    or coalesce(v_order.escrow_released,false)
    or v_order.handoff_completed_at is null
    or v_order.customer_handoff_confirmed_at is null
    or v_order.customer_handoff_confirmed_at + interval '72 hours' > now() then
    raise exception 'Ordinary earning is not past its accepted handoff and review window';
  end if;
  v_amount := case when coalesce(v_order.source_amount,0)>0
    then v_order.source_amount else v_order.subtotal_amount end;
  v_destination := case new.provider
    when 'STRIPE' then v_order.tailor_stripe_connect_account_id_locked
    when 'PAYSTACK' then v_order.tailor_paystack_recipient_code_locked
    else null end;
  if v_amount is null or v_amount<=0 or new.amount is distinct from v_amount
    or new.provider is distinct from v_order.tailor_payout_provider_locked::text
    or new.currency is distinct from v_order.tailor_payout_currency_locked
    or nullif(btrim(v_destination),'') is null
    or new.provider_destination_id is distinct from v_destination then
    raise exception 'Ordinary earning differs from its accepted route or amount';
  end if;
  if exists (select 1 from public.disputes d where d.order_id::text=new.order_id
      and d.status in ('OPEN','UNDER_REVIEW'))
    or exists (select 1 from public.order_payment_refund_claims r
      join public.order_payments p on p.id=r.payment_id
      where p.order_id::text=new.order_id and p.phase='INITIAL_ORDER'
        and r.status <> 'FAILED_RECONCILED') then
    raise exception 'Ordinary earning has an open dispute or refund operation';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION payment_internal.guard_new_order_earning_claim_eligibility() FROM PUBLIC, anon, authenticated, service_role;

-- payment_internal.guard_order_payout_claim_policy
CREATE OR REPLACE FUNCTION payment_internal.guard_order_payout_claim_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_policy text;
  v_expected_claim_policy text;
  v_snapshot jsonb;
  v_order public.orders%rowtype;
  v_destination text;
begin
  if new.source_kind not in ('ORDER_EARNING','SETTLEMENT_TRANCHE','RESIDUAL_SETTLEMENT') then
    return new;
  end if;
  perform payment_internal.assert_order_payout_policy(
    new.order_id,new.source_kind,new.source_id);
  select commercial_policy_version into v_policy
    from public.orders where id_text=new.order_id;
  if new.source_kind='SETTLEMENT_TRANCHE' then
    select plan.policy_version into v_expected_claim_policy
      from public.order_settlement_plans plan
      join public.order_settlement_tranches tranche on tranche.plan_id=plan.id
      where tranche.id::text=new.source_id and plan.order_id=new.order_id;
  elsif new.source_kind='RESIDUAL_SETTLEMENT' then
    -- Preview checks captured allocation, reviewed close, every tranche's
    -- terminal provider receipt, and the absence of a prior residual claim.
    v_snapshot:=public.preview_staged_residual_settlement(new.order_id);
    v_expected_claim_policy:='settlement-2026-08-01-v1';
    select * into v_order from public.orders where id_text=new.order_id;
    if v_order.accepted_route_snapshot_at is not null then
      select nullif(btrim(destination.provider_account_ref),'') into v_destination
        from public.payout_destinations destination
        where destination.id=v_order.payout_destination_id
          and destination.tailor_profile_id::text=new.tailor_profile_id
          and destination.provider=new.provider
          and destination.currency=new.currency::text
          and destination.active=true
          and destination.transfers_enabled=true
          and destination.payouts_enabled=true;
    else
      v_destination:=case new.provider
        when 'STRIPE' then nullif(btrim(v_order.tailor_stripe_connect_account_id_locked),'')
        when 'PAYSTACK' then nullif(btrim(v_order.tailor_paystack_recipient_code_locked),'')
        else null end;
    end if;
    if coalesce((v_snapshot->>'residualTailorEntitlement')::bigint,0)<=0
      or (v_snapshot->>'residualTailorEntitlement')::bigint is distinct from new.amount
      or (v_snapshot->>'currency')::public.currency is distinct from new.currency
      or v_snapshot->>'provider' is distinct from new.provider
      or new.business_key is distinct from 'order:'||new.order_id||':residual'
      or new.provider_idempotency_key is distinct from new.business_key||':op:1'
      or new.tailor_profile_id is distinct from v_order.tailor_profile_id::text
      or v_order.tailor_payout_provider_locked::text is distinct from new.provider
      or v_order.tailor_payout_currency_locked is distinct from new.currency
      or v_destination is null
      or v_destination is distinct from new.provider_destination_id
      or not exists (select 1 from public.tailor_profiles profile
        where profile.id::text=new.tailor_profile_id
          and profile.user_id=v_order.tailor_id
          and (v_order.accepted_route_snapshot_at is not null
            or (profile.payout_account_verified=true
              and profile.payout_reverification_required is not true))) then
      raise exception 'Residual claim differs from its reviewed staged snapshot';
    end if;
  else
    v_expected_claim_policy:=v_policy;
  end if;
  if new.earning_policy_version is distinct from v_expected_claim_policy then
    raise exception 'Payout claim policy differs from the accepted order';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION payment_internal.guard_order_payout_claim_policy() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION payment_internal.guard_order_payout_claim_policy() TO service_role;

-- payment_internal.guard_staged_residual_eligibility
CREATE OR REPLACE FUNCTION payment_internal.guard_staged_residual_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_plan public.order_settlement_plans%rowtype;
  v_event public.order_settlement_events%rowtype;
  v_reversal public.commercial_ledger_transactions%rowtype;
  v_preview jsonb;
  v_entitlement bigint;
  v_eligible bigint;
  v_released bigint;
  v_reversed bigint;
  v_entry_count integer;
  v_eligible_debit_count integer;
  v_entitlement_credit_count integer;
begin
  if new.source_kind <> 'RESIDUAL_SETTLEMENT' then return new; end if;
  select * into v_plan from public.order_settlement_plans
    where order_id=new.order_id;
  if not found then raise exception 'Residual settlement plan is missing'; end if;
  select * into v_event from public.order_settlement_events
    where plan_id=v_plan.id and event_type='RESIDUAL_TRANCHE_CANCELLATION';
  if not found then
    raise exception 'Staged residual needs its atomic tranche-cancellation event';
  end if;
  v_reversed:=(v_event.payload->>'eligibleReversed')::bigint;
  if v_reversed is null or v_reversed<0 then
    raise exception 'Staged residual eligibility reversal is invalid';
  end if;
  if v_reversed>0 then
    select * into v_reversal from public.commercial_ledger_transactions
      where id=(v_event.payload->>'eligibilityReversalLedgerTransactionId')::uuid;
    if not found or v_reversal.order_id is distinct from new.order_id
      or v_reversal.payment_id is distinct from v_plan.source_payment_id
      or v_reversal.transaction_kind<>'ADJUSTMENT'
      or v_reversal.purpose<>'SETTLEMENT_ELIGIBILITY_REVERSAL'
      or v_reversal.original_amount is distinct from v_reversed
      or v_reversal.original_currency is distinct from v_plan.currency
      or v_reversal.settlement_amount is distinct from v_reversed
      or v_reversal.settlement_currency is distinct from v_plan.currency
      or v_reversal.fx_rate<>1
      or v_reversal.provider_fee_amount<>0 then
      raise exception 'Staged residual eligibility reversal receipt is missing';
    end if;
    select count(*),
      count(*) filter (where account_code='TAILOR_ELIGIBLE'
        and account_scope=new.order_id
        and direction='DEBIT' and amount=v_reversed
        and currency=v_plan.currency),
      count(*) filter (where account_code='TAILOR_ENTITLEMENT'
        and account_scope=new.order_id
        and direction='CREDIT' and amount=v_reversed
        and currency=v_plan.currency)
      into v_entry_count,v_eligible_debit_count,v_entitlement_credit_count
      from public.commercial_ledger_entries
      where transaction_id=v_reversal.id;
    if v_entry_count<>2 or v_eligible_debit_count<>1
      or v_entitlement_credit_count<>1 then
      raise exception 'Staged residual eligibility reversal is unbalanced';
    end if;
  elsif v_event.payload->>'eligibilityReversalLedgerTransactionId' is not null then
    raise exception 'Zero eligible reversal has an unexpected ledger receipt';
  end if;

  v_preview:=public.preview_staged_residual_settlement(new.order_id);
  select
    coalesce(sum(case when e.account_code='TAILOR_ENTITLEMENT'
      then case when e.direction='CREDIT' then e.amount else -e.amount end
      else 0 end),0),
    coalesce(sum(case when e.account_code='TAILOR_ELIGIBLE'
      then case when e.direction='CREDIT' then e.amount else -e.amount end
      else 0 end),0),
    coalesce(sum(case when e.account_code='TAILOR_RELEASED'
      then case when e.direction='CREDIT' then e.amount else -e.amount end
      else 0 end),0)
    into v_entitlement,v_eligible,v_released
    from public.commercial_ledger_transactions tx
    join public.commercial_ledger_entries e on e.transaction_id=tx.id
    where tx.order_id=new.order_id
      and tx.payment_id=v_plan.source_payment_id
      and e.currency=v_plan.currency
      and e.account_code in
        ('TAILOR_ENTITLEMENT','TAILOR_ELIGIBLE','TAILOR_RELEASED');
  if v_entitlement<0 or v_eligible<>0 or v_released<0
    or v_entitlement is distinct from new.amount
    or v_released is distinct from
      (v_preview->>'releasedTranches')::bigint
    or new.amount is distinct from
      (v_preview->>'residualTailorEntitlement')::bigint then
    raise exception 'Staged residual work ledger does not reconcile with its reviewed amount';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION payment_internal.guard_staged_residual_eligibility() FROM PUBLIC, anon, authenticated, service_role;

-- payment_internal.require_tranche_work_before_provider
CREATE OR REPLACE FUNCTION payment_internal.require_tranche_work_before_provider()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_source_payment_id uuid;
begin
  if old.source_kind<>'SETTLEMENT_TRANCHE'
    or old.status<>'RESERVED' or new.status<>'PROVIDER_UNKNOWN' then
    return new;
  end if;
  select plan.source_payment_id into v_source_payment_id
    from public.order_settlement_tranches tr
    join public.order_settlement_plans plan on plan.id=tr.plan_id
    where tr.id::text=new.source_id and tr.order_id=new.order_id;
  if v_source_payment_id is null
    or not exists (select 1 from public.order_work_funding_positions pos
      where pos.payout_claim_id=new.id and pos.use_kind='PAYOUT'
        and pos.source_payment_id=v_source_payment_id
        and pos.amount=new.amount and pos.status='RESERVED') then
    raise exception 'Staged payout lacks its exact work funding position; reconcile before provider call';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION payment_internal.require_tranche_work_before_provider() FROM PUBLIC, anon, authenticated, service_role;

-- payment_internal.reserve_staged_work_for_payout
CREATE OR REPLACE FUNCTION payment_internal.reserve_staged_work_for_payout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tranche public.order_settlement_tranches%rowtype;
  v_plan public.order_settlement_plans%rowtype;
begin
  if new.source_kind not in ('SETTLEMENT_TRANCHE','RESIDUAL_SETTLEMENT') then
    return new;
  end if;
  if new.source_kind='SETTLEMENT_TRANCHE' then
    select * into v_tranche from public.order_settlement_tranches
      where id::text=new.source_id;
    select * into v_plan from public.order_settlement_plans
      where id=v_tranche.plan_id;
    if v_tranche.id is null or v_plan.id is null
      or v_tranche.order_id is distinct from new.order_id
      or v_tranche.amount is distinct from new.amount
      or v_plan.status<>'ACTIVE' then
      raise exception 'Staged payout lacks an exact active tranche';
    end if;
    if exists (select 1 from public.order_payment_refund_claims
        where payment_id=v_plan.source_payment_id) then
      raise exception 'Staged work has a refund claim; review before payout';
    end if;
  else
    select * into v_plan from public.order_settlement_plans
      where order_id=new.order_id;
    if v_plan.id is null or v_plan.status not in ('ACTIVE','FROZEN')
      or v_plan.policy_version is distinct from new.earning_policy_version
      or new.source_id is distinct from new.order_id then
      raise exception 'Residual payout lacks its accepted staged plan';
    end if;
    -- A completed close-order refund is expected here. An unresolved provider
    -- refund is not: it may still consume the same remaining work position.
    if exists (select 1 from public.order_payment_refund_claims
        where payment_id=v_plan.source_payment_id
          and status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING')) then
      raise exception 'Residual payout waits for the refund provider outcome';
    end if;
  end if;
  perform payment_internal.ensure_order_work_funding_source(
    v_plan.source_payment_id,v_plan.id,null,new.id);
  insert into public.order_work_funding_positions (
    source_payment_id,use_kind,payout_claim_id,amount
  ) values (v_plan.source_payment_id,'PAYOUT',new.id,new.amount);
  return new;
end $function$;

REVOKE ALL ON FUNCTION payment_internal.reserve_staged_work_for_payout() FROM PUBLIC, anon, authenticated, service_role;

-- public.freeze_payout_claim_link
CREATE OR REPLACE FUNCTION public.freeze_payout_claim_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.payout_id is not null
    and new.payout_id is distinct from old.payout_id then
    raise exception 'Linked payout cannot be changed or cleared from its earning claim';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.freeze_payout_claim_link() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.freeze_payout_claim_link() TO service_role;

-- public.guard_fabric_claim_locked_destination
CREATE OR REPLACE FUNCTION public.guard_fabric_claim_locked_destination()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order public.orders%rowtype;
  v_candidate public.order_fabric_candidates%rowtype;
  v_locked text;
begin
  if new.source_kind<>'FABRIC_RELEASE' then return new; end if;
  select * into v_candidate from public.order_fabric_candidates
    where id::text=new.source_id;
  if not found or v_candidate.customer_decision is distinct from 'APPROVE'
    or v_candidate.status not in ('RELEASE_QUEUED','RELEASE_PROCESSING','RELEASE_BLOCKED')
    or v_candidate.provider_status='SUCCEEDED'
    or row(v_candidate.order_id,v_candidate.currency,v_candidate.supplier_cost_amount,
           v_candidate.policy_version)
       is distinct from row(new.order_id,new.currency,new.amount,
                            new.earning_policy_version) then
    raise exception 'Fabric claim does not match an approved candidate';
  end if;
  select * into v_order from public.orders where id_text=new.order_id;
  if not found or v_order.tailor_id::text is distinct from v_candidate.tailor_id
    or v_order.tailor_payout_provider_locked::text is distinct from new.provider
    or v_order.tailor_payout_currency_locked is distinct from new.currency then
    raise exception 'Fabric claim does not match its accepted order route';
  end if;
  if v_order.accepted_route_snapshot_at is not null then
    select nullif(btrim(destination.provider_account_ref),'') into v_locked
      from public.payout_destinations destination
      where destination.id=v_order.payout_destination_id
        and destination.tailor_profile_id::text=new.tailor_profile_id
        and destination.provider=new.provider
        and destination.currency=new.currency::text
        and destination.active=true
        and destination.transfers_enabled=true
        and destination.payouts_enabled=true;
  else
    v_locked := case new.provider
      when 'STRIPE' then nullif(btrim(v_order.tailor_stripe_connect_account_id_locked),'')
      when 'PAYSTACK' then nullif(btrim(v_order.tailor_paystack_recipient_code_locked),'')
      else null
    end;
  end if;
  if v_locked is null or v_locked is distinct from new.provider_destination_id then
    raise exception 'Fabric claim destination does not match the accepted order';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.guard_fabric_claim_locked_destination() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_fabric_claim_locked_destination() TO service_role;

-- public.guard_material_claim_source_identity
CREATE OR REPLACE FUNCTION public.guard_material_claim_source_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_advance public.order_material_advances%rowtype;
  v_order public.orders%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_locked text;
  v_policy text;
begin
  if new.source_kind<>'MATERIAL_ADVANCE' then return new; end if;
  select * into v_advance from public.order_material_advances
    where id::text=new.source_id;
  if not found or v_advance.released_at is not null
    or v_advance.release_status='RELEASED'
    or v_advance.provider_release_status='SUCCEEDED'
    or row(v_advance.order_id::text,v_advance.amount,v_advance.currency)
       is distinct from row(new.order_id,new.amount,new.currency) then
    raise exception 'Material claim does not match an unreleased advance';
  end if;
  select * into v_order from public.orders where id_text=new.order_id;
  select * into v_profile from public.tailor_profiles
    where id::text=new.tailor_profile_id;
  if v_order.id is null or v_profile.id is null
    or v_order.tailor_id::text is distinct from v_advance.tailor_id::text
    or v_profile.user_id::text is distinct from v_advance.tailor_id::text
    or v_order.tailor_payout_provider_locked::text is distinct from new.provider
    or v_order.tailor_payout_currency_locked is distinct from new.currency then
    raise exception 'Material claim does not match its accepted order route';
  end if;
  if v_order.accepted_route_snapshot_at is not null then
    select nullif(btrim(destination.provider_account_ref),'') into v_locked
      from public.payout_destinations destination
      where destination.id=v_order.payout_destination_id
        and destination.tailor_profile_id::text=new.tailor_profile_id
        and destination.provider=new.provider
        and destination.currency=new.currency::text
        and destination.active=true
        and destination.transfers_enabled=true
        and destination.payouts_enabled=true;
  else
    v_locked := case new.provider
      when 'STRIPE' then nullif(btrim(v_order.tailor_stripe_connect_account_id_locked),'')
      when 'PAYSTACK' then nullif(btrim(v_order.tailor_paystack_recipient_code_locked),'')
      else null
    end;
  end if;
  if v_locked is null or v_locked is distinct from new.provider_destination_id then
    raise exception 'Material claim destination does not match the accepted order';
  end if;
  if not exists (select 1 from public.money_desk_requests m
      where m.target_id=v_advance.id::text and m.order_id=v_advance.order_id::text
        and m.action_type='MATERIAL_ADVANCE_RELEASE'
        and m.target_type='ORDER_MATERIAL_ADVANCE'
        and m.status='EXECUTING' and m.amount=v_advance.amount
        and m.currency=v_advance.currency
        and (v_advance.funding_source<>'FUNDED_FABRIC_ALLOWANCE'
          or m.id=v_advance.money_desk_request_id)) then
    raise exception 'Material claim has no exact executing Money Desk authority';
  end if;
  if v_advance.funding_source='FUNDED_FABRIC_ALLOWANCE' then
    v_policy := coalesce(nullif(btrim(v_order.fabric_funding_policy_version),''),
      'fabric-funding-2026-08-01-v1');
    if v_advance.status not in ('OPS_REVIEW','BLOCKED')
      or v_advance.payment_id is not null
      or not exists (select 1 from public.order_fabric_funding_allocations a
        where a.id=v_advance.fabric_allocation_id
          and a.order_id::text=v_advance.order_id::text
          and a.funded_amount-a.released_amount-a.refunded_amount>=v_advance.amount) then
      raise exception 'Funded material claim has no available allowance';
    end if;
  elsif v_advance.funding_source='LEGACY_SEPARATE_PAYMENT' then
    v_policy := 'legacy-separate-material-advance';
    if v_advance.status not in ('PAID','OPS_REVIEW','BLOCKED')
      or v_advance.paid_at is null
      or not exists (select 1 from public.order_payments p
        where p.id=v_advance.payment_id and p.order_id::text=v_advance.order_id::text
          and p.phase='MATERIAL_ADVANCE' and p.status='SUCCEEDED'
          and p.ledger_recorded_at is not null and p.refunded_amount=0
          and p.amount=v_advance.amount and p.currency=v_advance.currency
          and p.provider::text=new.provider) then
      raise exception 'Separately paid material claim has no settled charge';
    end if;
  else
    raise exception 'Material claim has unsupported funding source';
  end if;
  if new.earning_policy_version is distinct from v_policy then
    raise exception 'Material claim policy differs from its funding source';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.guard_material_claim_source_identity() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_material_claim_source_identity() TO service_role;

-- public.guard_tailor_adjustment_payout_claim
CREATE OR REPLACE FUNCTION public.guard_tailor_adjustment_payout_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_adjustment public.commercial_adjustments%rowtype;
  v_order public.orders%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_payment public.order_payments%rowtype;
  v_capture public.commercial_ledger_transactions%rowtype;
  v_capture_count integer;
  v_earning integer;
  v_locked_destination text;
  v_gate jsonb;
begin
  if new.source_kind<>'TAILOR_ADJUSTMENT' then return new; end if;
  if new.source_id is null or new.source_id !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'Adjustment claim needs its exact source ID';
  end if;
  select * into v_adjustment from public.commercial_adjustments
    where id=new.source_id::uuid for update;
  if v_adjustment.id is null
    or new.business_key is distinct from 'adjustment:'||v_adjustment.id::text
    or new.provider_idempotency_key is distinct from
      'adjustment:'||v_adjustment.id::text||':op:1'
    or new.order_id is distinct from v_adjustment.order_id
    or new.currency is distinct from v_adjustment.currency
    or new.earning_policy_version is distinct from
      v_adjustment.tailor_release_policy_version
    or new.status<>'RESERVED' or new.transfer_status<>'NOT_STARTED'
    or new.withdrawal_status<>'NOT_STARTED' or new.payout_id is not null
    or new.provider_transfer_id is not null then
    raise exception 'Adjustment earning claim identity is not frozen';
  end if;
  select * into v_order from public.orders
    where id_text=v_adjustment.order_id for update;
  if v_order.id is null or v_order.tailor_profile_id::text is distinct from
      new.tailor_profile_id
    or v_order.tailor_payout_provider_locked::text is distinct from new.provider
    or v_order.tailor_payout_currency_locked is distinct from new.currency then
    raise exception 'Adjustment claim differs from the accepted payout route';
  end if;
  v_locked_destination:=case new.provider
    when 'STRIPE' then nullif(btrim(v_order.tailor_stripe_connect_account_id_locked),'')
    when 'PAYSTACK' then nullif(btrim(v_order.tailor_paystack_recipient_code_locked),'')
    else null end;
  if v_locked_destination is null
    or v_locked_destination is distinct from new.provider_destination_id then
    raise exception 'Adjustment claim destination differs from the accepted order';
  end if;
  select * into v_profile from public.tailor_profiles
    where id::text=new.tailor_profile_id;
  if v_profile.id is null or v_profile.user_id::text is distinct from
      v_adjustment.tailor_id
    or v_profile.payout_account_verified is distinct from true
    or v_profile.payout_reverification_required is true then
    raise exception 'Adjustment tailor payout destination is not verified';
  end if;
  select * into v_payment from public.order_payments
    where id=v_adjustment.payment_id for update;
  if v_payment.id is null or v_payment.phase::text<>'ADJUSTMENT'
    or v_payment.order_id::text is distinct from v_adjustment.order_id
    or v_payment.currency is distinct from v_adjustment.currency
    or v_payment.provider::text is distinct from new.provider
    or v_payment.status::text<>'SUCCEEDED'
    or v_payment.refunded_amount<>0 or v_payment.amount<>v_adjustment.amount_delta
    or v_payment.ledger_recorded_at is null
    or v_payment.provider_payment_id is null
    or (v_payment.commercial_breakdown->>'adjustmentAllocation')
      is distinct from 'TAILOR' then
    raise exception 'Adjustment charge has no unreversed tailor capture';
  end if;
  select count(*) into v_capture_count from public.commercial_ledger_transactions
    where payment_id=v_payment.id and order_id=v_adjustment.order_id
      and transaction_kind='CAPTURE' and purpose='ADJUSTMENT';
  if v_capture_count<>1 then
    raise exception 'Adjustment needs one exact capture ledger transaction';
  end if;
  select * into v_capture from public.commercial_ledger_transactions
    where payment_id=v_payment.id and order_id=v_adjustment.order_id
      and transaction_kind='CAPTURE' and purpose='ADJUSTMENT';
  select coalesce(sum(amount),0)::integer into v_earning
    from public.commercial_ledger_entries
    where transaction_id=v_capture.id and account_code='TAILOR_ENTITLEMENT'
      and account_scope=v_adjustment.order_id and direction='CREDIT'
      and currency=v_adjustment.currency;
  if v_capture.original_amount<>v_payment.amount
    or v_capture.original_currency is distinct from v_payment.currency
    or v_capture.provider_reference is distinct from v_payment.provider_payment_id
    or v_earning<=0 or v_earning<>new.amount
    or v_earning is distinct from
      (v_payment.commercial_breakdown->>'subtotalAmount')::integer then
    raise exception 'Adjustment claim differs from the captured tailor earning';
  end if;
  if exists(select 1 from public.order_payment_refund_claims r
      where r.payment_id=v_adjustment.payment_id)
    or exists(select 1 from public.adjustment_money_operation_claims c
      where c.adjustment_id=v_adjustment.id
        and c.operation_kind='REFUND') then
    raise exception 'Adjustment earning requires Money Desk refund reconciliation';
  end if;
  v_gate:=public.tailor_adjustment_release_gate(v_adjustment.id);
  if v_gate->>'state'<>'READY_FOR_MONEY_DESK' then
    raise exception 'Adjustment delivery/protection gate is not ready: %',
      v_gate->>'state';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.guard_tailor_adjustment_payout_claim() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_tailor_adjustment_payout_claim() TO service_role;

-- public.guard_tranche_claim_source_identity
CREATE OR REPLACE FUNCTION public.guard_tranche_claim_source_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tranche public.order_settlement_tranches%rowtype;
  v_plan public.order_settlement_plans%rowtype;
  v_order public.orders%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_locked text;
begin
  if new.source_kind<>'SETTLEMENT_TRANCHE' then return new; end if;
  select * into v_tranche from public.order_settlement_tranches
    where id::text=new.source_id;
  if not found or v_tranche.status<>'ELIGIBLE'
    or v_tranche.eligible_at is null or v_tranche.eligible_at>now()
    or row(v_tranche.order_id,v_tranche.amount,v_tranche.currency)
       is distinct from row(new.order_id,new.amount,new.currency)
    or new.business_key is distinct from 'tranche:'||v_tranche.id::text
    or new.provider_idempotency_key is distinct from
       'tranche:'||v_tranche.id::text||':op:1' then
    raise exception 'Tranche claim does not match an eligible earning';
  end if;
  select * into v_plan from public.order_settlement_plans
    where id=v_tranche.plan_id;
  select * into v_order from public.orders where id_text=v_tranche.order_id;
  select * into v_profile from public.tailor_profiles
    where id::text=new.tailor_profile_id;
  if v_plan.id is null or v_plan.status<>'ACTIVE'
    or v_order.id is null or v_profile.id is null
    or v_plan.order_id is distinct from v_tranche.order_id
    or v_plan.currency is distinct from v_tranche.currency
    or v_plan.policy_version is distinct from new.earning_policy_version
    or v_order.tailor_id::text is distinct from v_plan.tailor_id::text
    or v_profile.user_id::text is distinct from v_plan.tailor_id::text
    or (v_order.accepted_route_snapshot_at is null
      and (v_profile.payout_account_verified is distinct from true
        or v_profile.payout_reverification_required is true))
    or v_order.tailor_payout_provider_locked::text is distinct from new.provider
    or v_order.tailor_payout_currency_locked is distinct from new.currency then
    raise exception 'Tranche claim does not match its active accepted route';
  end if;
  if v_order.accepted_route_snapshot_at is not null then
    select nullif(btrim(destination.provider_account_ref),'') into v_locked
      from public.payout_destinations destination
      where destination.id=v_order.payout_destination_id
        and destination.tailor_profile_id::text=new.tailor_profile_id
        and destination.provider=new.provider
        and destination.currency=new.currency::text
        and destination.active=true
        and destination.transfers_enabled=true
        and destination.payouts_enabled=true;
  else
    v_locked := case new.provider
      when 'STRIPE' then nullif(btrim(v_order.tailor_stripe_connect_account_id_locked),'')
      when 'PAYSTACK' then nullif(btrim(v_order.tailor_paystack_recipient_code_locked),'')
      else null
    end;
  end if;
  if v_locked is null or v_locked is distinct from new.provider_destination_id then
    raise exception 'Tranche claim destination does not match the accepted order';
  end if;
  if not exists (select 1 from public.order_payments p
      where p.id=v_plan.source_payment_id and p.order_id::text=v_tranche.order_id
        and p.phase='INITIAL_ORDER' and p.status='SUCCEEDED'
        and p.ledger_recorded_at is not null and p.refunded_amount=0
        and p.currency=v_tranche.currency and p.provider::text=new.provider)
    or not exists (select 1 from public.money_desk_requests m
      where m.target_id=v_tranche.id::text and m.order_id=v_tranche.order_id
        and m.action_type='PAYOUT_RELEASE'
        and m.target_type='SETTLEMENT_TRANCHE' and m.status='EXECUTING'
        and m.amount=v_tranche.amount and m.currency=v_tranche.currency
        and m.approval_count>=m.required_approval_count) then
    raise exception 'Tranche claim lacks settled funds or reviewed release authority';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.guard_tranche_claim_source_identity() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_tranche_claim_source_identity() TO service_role;

-- public.prevent_unreviewed_blocked_payout_transition
CREATE OR REPLACE FUNCTION public.prevent_unreviewed_blocked_payout_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.status = 'BLOCKED' and new.status <> 'BLOCKED' then
    raise exception 'Blocked payout claim requires reviewed reconciliation';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.prevent_unreviewed_blocked_payout_transition() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prevent_unreviewed_blocked_payout_transition() TO service_role;
