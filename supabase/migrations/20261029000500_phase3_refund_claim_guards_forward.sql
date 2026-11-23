-- Forward-only restoration of refund claim guards missing from Production's
-- pre-Phase-2 migration history. Definitions derive from the final Dev catalog and adapt native UUID
-- order/payout IDs through their text bridges; each function's origin was located on the isolated Phase 1 branch.
-- Money Edge deployment remains blocked until the bindings migration passes.

-- payment_internal.confirm_order_work_refund_from_claim
CREATE OR REPLACE FUNCTION payment_internal.confirm_order_work_refund_from_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.phase='INITIAL_ORDER' and new.status='SUCCEEDED'
    and nullif(btrim(new.provider_refund_id),'') is not null then
    update public.order_work_funding_positions set status='REFUND_CONFIRMED'
      where refund_claim_id=new.id and use_kind='REFUND' and status='RESERVED';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION payment_internal.confirm_order_work_refund_from_claim() FROM PUBLIC, anon, authenticated, service_role;

-- payment_internal.require_refund_work_before_provider
CREATE OR REPLACE FUNCTION payment_internal.require_refund_work_before_provider()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_policy text;
  v_plan_id uuid;
  v_work_debit bigint;
begin
  if new.phase<>'INITIAL_ORDER'
    or old.status<>'RESERVED' or new.status<>'PROVIDER_UNKNOWN' then
    return new;
  end if;
  select commercial_policy_version into v_policy
    from public.orders where id_text=new.order_id;
  if v_policy='legacy-single-release-72h' then
    return new; -- accepted legacy policy has no staged work positions
  end if;
  if v_policy is distinct from 'commercial-2026-07-31-v1' then
    raise exception 'Refund order policy is missing or unrecognized; Money Desk review required';
  end if;
  select id into v_plan_id from public.order_settlement_plans
    where source_payment_id=new.payment_id and order_id=new.order_id;
  if v_plan_id is null
    or jsonb_typeof(new.refund_context->'ledger_entries') is distinct from 'array' then
    raise exception 'Staged refund lacks an exact plan and frozen allocation; reconcile before provider call';
  end if;
  select coalesce(sum((entry->>'amount')::bigint),0) into v_work_debit
    from jsonb_array_elements(new.refund_context->'ledger_entries') entry
    where entry->>'direction'='DEBIT'
      and entry->>'accountCode' in ('TAILOR_ENTITLEMENT','TAILOR_ELIGIBLE');
  if v_work_debit>0 and not exists (
    select 1 from public.order_work_funding_positions pos
    join public.order_work_funding_sources src
      on src.payment_id=pos.source_payment_id
    where pos.refund_claim_id=new.id and pos.use_kind='REFUND'
      and pos.source_payment_id=new.payment_id
      and src.plan_id=v_plan_id and pos.amount=v_work_debit
      and pos.status='RESERVED') then
    raise exception 'Staged refund lacks its exact work funding position; reconcile before provider call';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION payment_internal.require_refund_work_before_provider() FROM PUBLIC, anon, authenticated, service_role;

-- payment_internal.reserve_staged_work_for_refund
CREATE OR REPLACE FUNCTION payment_internal.reserve_staged_work_for_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.order_settlement_plans%rowtype;
  v_work_debit bigint;
begin
  if old.refund_context is not null or new.refund_context is null
    or new.phase<>'INITIAL_ORDER' then return new; end if;
  select coalesce(sum((entry->>'amount')::bigint),0) into v_work_debit
    from jsonb_array_elements(new.refund_context->'ledger_entries') entry
    where entry->>'direction'='DEBIT'
      and entry->>'accountCode' in ('TAILOR_ENTITLEMENT','TAILOR_ELIGIBLE');
  if v_work_debit=0 then return new; end if;
  select * into v_plan from public.order_settlement_plans
    where source_payment_id=new.payment_id;
  if v_plan.id is null then return new; end if; -- legacy-policy refund
  if v_work_debit>2147483647 then
    raise exception 'Staged work refund allocation exceeds integer minor units';
  end if;
  perform payment_internal.ensure_order_work_funding_source(
    new.payment_id,v_plan.id,new.id,null);
  insert into public.order_work_funding_positions (
    source_payment_id,use_kind,refund_claim_id,amount
  ) values (new.payment_id,'REFUND',new.id,v_work_debit::integer);
  return new;
end $function$;

REVOKE ALL ON FUNCTION payment_internal.reserve_staged_work_for_refund() FROM PUBLIC, anon, authenticated, service_role;

-- public.case_late_order_refund_claim_success
CREATE OR REPLACE FUNCTION public.case_late_order_refund_claim_success()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  begin
    insert into public.ops_issues (
      issue_type,severity,status,source,order_id,
      related_entity_type,related_entity_id,provider,title,description,
      recommended_action,dedupe_key,metadata,
      queue_key,owning_team,priority,sensitivity,environment,
      canonical_status,provenance
    ) values (
      'PAYMENT_LATE_SUCCESS','CRITICAL','OPEN',
      'order-refund-claim-reconciliation',new.order_id,
      'ORDER_PAYMENT_REFUND_CLAIM',new.id::text,new.provider::text,
      'Refund succeeded after a recorded failure',
      'The provider confirmed a refund after an earlier reconciled failure. Reconcile the customer charge, refund ledger, and any tailor payout before another money action.',
      'Verify the provider refund once, finalize the original claim, and review any payout or recovery; do not issue another refund.',
      'order-refund-claim-late-success:'||new.id::text,
      jsonb_build_object('claim_id',new.id,'payment_id',new.payment_id,
        'provider_refund_id',new.provider_refund_id,
        'refund_amount',new.refund_amount,'currency',new.currency),
      'money-desk','finance','P0','SENSITIVE',
      public.current_ops_environment(),'NEW','REAL'
    ) on conflict (dedupe_key) do update
      set status='OPEN',canonical_status='NEW',
        queue_key='money-desk',owning_team='finance',priority='P0',
        environment=case when public.ops_issues.environment='UNKNOWN'
          then excluded.environment else public.ops_issues.environment end,
        last_seen_at=now();
  exception when others then
    -- Provider-confirmed money must be recorded even if case creation fails.
    raise warning 'Late refund claim Ops case failed for claim %: %',
      new.id,sqlerrm;
  end;
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION public.case_late_order_refund_claim_success() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.case_late_order_refund_claim_success() TO service_role;

-- public.guard_drapeon_funded_adjustment_refund_snapshot
CREATE OR REPLACE FUNCTION public.guard_drapeon_funded_adjustment_refund_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_operation public.adjustment_money_operation_claims%rowtype;
  v_provider_scope text;
  v_provider_count integer;
  v_entries jsonb;
  v_expected jsonb;
begin
  if new.phase::text<>'ADJUSTMENT' or new.refund_context is null
    or new.refund_context is not distinct from old.refund_context then
    return new;
  end if;
  select * into v_operation from public.adjustment_money_operation_claims
    where request_key=new.operation_key and operation_kind='REFUND';
  if v_operation.id is null or v_operation.source_payment_id<>new.payment_id
    or v_operation.adjustment_id is null
    or v_operation.amount<>new.refund_amount
    or v_operation.currency<>new.currency then
    raise exception 'Adjustment refund allocation lacks exact reviewed operation';
  end if;
  if v_operation.refund_funding_mode not in
    ('DRAPEON_FUNDED_UNPAID','POST_PAYOUT') then
    return new;
  end if;
  select count(*),min(e.account_scope) into v_provider_count,v_provider_scope
    from public.commercial_ledger_transactions t
    join public.commercial_ledger_entries e on e.transaction_id=t.id
    where t.id=v_operation.capture_transaction_id
      and t.payment_id=new.payment_id
      and t.transaction_kind='CAPTURE' and t.purpose='ADJUSTMENT'
      and e.account_code='PROVIDER_CLEARING' and e.direction='DEBIT'
      and e.currency=new.currency;
  if v_provider_count<>1 or nullif(btrim(v_provider_scope),'') is null then
    raise exception 'Adjustment refund capture has no exact provider clearing account';
  end if;
  v_entries:=new.refund_context->'ledger_entries';
  v_expected:=jsonb_build_array(
    jsonb_build_object('accountCode','DRAPEON_FUNDED_REFUND',
      'accountScope','adjustment:'||v_operation.adjustment_id::text,
      'direction','DEBIT','amount',new.refund_amount,
      'currency',new.currency),
    jsonb_build_object('accountCode','PROVIDER_CLEARING',
      'accountScope',v_provider_scope,'direction','CREDIT',
      'amount',new.refund_amount,'currency',new.currency));
  if jsonb_typeof(v_entries) is distinct from 'array'
    or jsonb_array_length(v_entries)<>2
    or not (v_entries @> v_expected) then
    raise exception 'Completed adjustment refund must be Drapeon-funded';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.guard_drapeon_funded_adjustment_refund_snapshot() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_drapeon_funded_adjustment_refund_snapshot() TO service_role;

-- public.guard_new_refund_against_claimed_replacement
CREATE OR REPLACE FUNCTION public.guard_new_refund_against_claimed_replacement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A direct service-role insert must obey the same gate as the checked RPC.
  perform 1 from public.orders where id_text=new.order_id for update;
  if not found then raise exception 'Refund order is missing'; end if;
  if exists (
    select 1 from public.payout_provider_operations o
    join public.payout_claims c on c.id=o.claim_id
    join public.payouts p on p.id::text=c.payout_id
    where p.source_payment_id=new.payment_id and c.order_id=new.order_id
      and c.source_kind='ORDER_EARNING' and o.operation_number>1
      and o.status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING',
        'TRANSFERRED','WITHDRAWN')
  ) then
    raise exception 'Replacement transfer outcome must be resolved before refund';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.guard_new_refund_against_claimed_replacement() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_new_refund_against_claimed_replacement() TO service_role;

-- public.guard_order_payment_refund_context
CREATE OR REPLACE FUNCTION public.guard_order_payment_refund_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.refund_context is not null
    and new.refund_context is distinct from old.refund_context then
    raise exception 'Approved refund context cannot change';
  end if;
  if old.refund_context is null and new.refund_context is not null
    and old.status <> 'RESERVED' then
    raise exception 'Uncertain refund claim cannot acquire new context';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.guard_order_payment_refund_context() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_order_payment_refund_context() TO service_role;

-- public.guard_reviewed_adjustment_refund_claim
CREATE OR REPLACE FUNCTION public.guard_reviewed_adjustment_refund_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_adjustment public.commercial_adjustments%rowtype;
  v_operation public.adjustment_money_operation_claims%rowtype;
  v_request public.money_desk_requests%rowtype;
  v_payout public.payout_claims%rowtype;
  v_approvers integer;
begin
  if new.phase::text<>'ADJUSTMENT' then return new; end if;
  select * into v_adjustment from public.commercial_adjustments
    where payment_id=new.payment_id and order_id=new.order_id;
  select * into v_operation from public.adjustment_money_operation_claims
    where request_key=new.operation_key and operation_kind='REFUND';
  if v_adjustment.id is null or v_operation.id is null
    or v_adjustment.status not in ('PAID','COMPLETED')
    or v_adjustment.currency<>new.currency
    or v_operation.adjustment_id<>v_adjustment.id
    or v_operation.source_payment_id<>new.payment_id
    or v_operation.amount<>new.refund_amount
    or v_operation.currency<>new.currency
    or v_operation.status<>'RESERVED'
    or not exists(select 1 from public.commercial_ledger_transactions c
      where c.id=v_operation.capture_transaction_id
        and c.payment_id=new.payment_id and c.order_id=new.order_id
        and c.transaction_kind='CAPTURE' and c.purpose='ADJUSTMENT') then
    raise exception 'Adjustment refund requires exact reviewed reservation';
  end if;
  select * into v_request from public.money_desk_requests
    where id=v_operation.money_desk_request_id;
  if v_request.id is null or v_request.action_type<>'CUSTOMER_REFUND'
    or v_request.target_type<>'TAILOR_ADJUSTMENT'
    or v_request.target_id<>v_adjustment.id::text
    or v_request.order_id<>new.order_id
    or v_request.amount<>new.refund_amount
    or v_request.currency<>new.currency
    or v_request.status<>'EXECUTING'
    or v_request.approved_at is null
    or v_request.approval_count<>v_request.required_approval_count
    or not exists(select 1 from public.money_desk_execution_attempts e
      where e.request_id=v_request.id and e.status='PROCESSING') then
    raise exception 'Adjustment refund lacks executing Money Desk approval';
  end if;
  select count(distinct lower(d.approver_email)) into v_approvers
    from public.money_desk_decisions d
    where d.request_id=v_request.id and d.decision='APPROVE'
      and lower(d.approver_email)<>lower(v_request.requester_email);
  if v_approvers<v_request.required_approval_count then
    raise exception 'Adjustment refund approvals are incomplete';
  end if;
  select * into v_payout from public.payout_claims
    where business_key='adjustment:'||v_adjustment.id::text;
  if v_payout.id is not null then
    if v_payout.status not in ('TRANSFERRED','WITHDRAWN')
      or v_payout.transfer_status<>'CONFIRMED'
      or v_operation.refund_funding_mode<>'POST_PAYOUT' then
      raise exception 'Adjustment refund waits for payout reconciliation';
    end if;
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.guard_reviewed_adjustment_refund_claim() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_reviewed_adjustment_refund_claim() TO service_role;

-- public.sync_adjustment_refund_provider_outcome
CREATE OR REPLACE FUNCTION public.sync_adjustment_refund_provider_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_operation public.adjustment_money_operation_claims%rowtype;
  v_next text;
  v_problem text;
  v_late boolean;
begin
  if new.phase::text<>'ADJUSTMENT' or
    (new.status is not distinct from old.status
      and new.provider_refund_id is not distinct from old.provider_refund_id) then
    return null;
  end if;
  select * into v_operation from public.adjustment_money_operation_claims
    where request_key=new.operation_key and operation_kind='REFUND'
    for update;
  if v_operation.id is null
    or v_operation.source_payment_id is distinct from new.payment_id
    or v_operation.amount is distinct from new.refund_amount
    or v_operation.currency is distinct from new.currency then
    v_problem:='The refund claim has no matching reviewed adjustment operation';
  elsif v_operation.provider_operation_id is not null
    and v_operation.provider_operation_id is distinct from new.provider_refund_id then
    v_problem:='The adjustment refund provider reference changed';
  end if;
  v_late:=new.status='SUCCEEDED' and
    (old.status='FAILED_RECONCILED'
      or v_operation.status in ('FAILED_RECONCILED','BLOCKED'));
  v_next:=case when v_late then 'LATE_SUCCEEDED' else new.status end;
  if v_problem is null and v_operation.status in ('SUCCEEDED','LATE_SUCCEEDED')
    and v_operation.status is distinct from v_next then
    v_problem:='The reviewed adjustment refund operation is terminal';
  end if;
  if v_problem is not null then
    begin
      insert into public.ops_issues (
        issue_type,severity,status,source,order_id,
        related_entity_type,related_entity_id,provider,title,description,
        recommended_action,dedupe_key,metadata,
        queue_key,owning_team,priority,sensitivity,environment,
        canonical_status,provenance
      ) values (
        'PAYMENT_STATUS_TRANSITION','CRITICAL','OPEN',
        'adjustment-refund-outcome-sync',new.order_id,
        'ORDER_PAYMENT_REFUND_CLAIM',new.id::text,new.provider::text,
        'Adjustment refund receipt needs reconciliation',v_problem,
        'Verify the provider refund and the reviewed Money Desk operation; do not issue another refund.',
        'adjustment-refund-sync:'||new.id::text,
        jsonb_build_object('claim_id',new.id,'operation_id',v_operation.id,
          'claim_status',new.status,'operation_status',v_operation.status),
        'money-desk','finance','P0','SENSITIVE',
        public.current_ops_environment(),'NEW','REAL'
      ) on conflict (dedupe_key) do update
        set status='OPEN',canonical_status='NEW',last_seen_at=now();
    exception when others then
      raise warning 'Adjustment refund sync case failed for claim %: %',
        new.id,sqlerrm;
    end;
    -- Keep the provider-confirmed generic claim even if the linked operation
    -- is corrupt; Money Desk must reconcile before another money action.
    return null;
  end if;
  update public.adjustment_money_operation_claims set
    status=v_next,
    provider_operation_id=coalesce(provider_operation_id,new.provider_refund_id),
    provider_evidence=new.provider_evidence,
    provider_checked_at=now(),
    terminal_at=case when v_next in
      ('SUCCEEDED','LATE_SUCCEEDED','FAILED_RECONCILED') then now()
      else null end
  where id=v_operation.id;
  if v_late and old.status<>'FAILED_RECONCILED' then
    begin
      insert into public.ops_issues (
        issue_type,severity,status,source,order_id,
        related_entity_type,related_entity_id,provider,title,description,
        recommended_action,dedupe_key,metadata,
        queue_key,owning_team,priority,sensitivity,environment,
        canonical_status,provenance
      ) values (
        'PAYMENT_LATE_SUCCESS','CRITICAL','OPEN',
        'adjustment-refund-outcome-sync',new.order_id,
        'ORDER_PAYMENT_REFUND_CLAIM',new.id::text,new.provider::text,
        'Adjustment refund succeeded after its operation was blocked',
        'The provider confirmed a refund after its reviewed operation was marked failed or blocked.',
        'Reconcile the original refund claim and provider receipt; do not send another refund.',
        'order-refund-claim-late-success:'||new.id::text,
        jsonb_build_object('claim_id',new.id,'operation_id',v_operation.id,
          'provider_refund_id',new.provider_refund_id),
        'money-desk','finance','P0','SENSITIVE',
        public.current_ops_environment(),'NEW','REAL'
      ) on conflict (dedupe_key) do update
        set status='OPEN',canonical_status='NEW',last_seen_at=now();
    exception when others then
      raise warning 'Late adjustment refund case failed for claim %: %',
        new.id,sqlerrm;
    end;
  end if;
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION public.sync_adjustment_refund_provider_outcome() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_adjustment_refund_provider_outcome() TO service_role;

-- public.validate_order_payment_refund_ledger_snapshot
CREATE OR REPLACE FUNCTION public.validate_order_payment_refund_ledger_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_entries jsonb;
  v_entry jsonb;
  v_amount numeric;
  v_debits numeric := 0;
  v_credits numeric := 0;
  v_provider_credits integer := 0;
begin
  if new.refund_context is null or new.refund_context is not distinct from old.refund_context then
    return new;
  end if;
  v_entries := new.refund_context->'ledger_entries';
  if jsonb_typeof(v_entries) is distinct from 'array' then
    raise exception 'Refund approval needs a frozen ledger allocation';
  end if;
  if jsonb_array_length(v_entries)<2 then
    raise exception 'Refund approval needs a frozen ledger allocation';
  end if;
  for v_entry in select value from jsonb_array_elements(v_entries) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or nullif(btrim(v_entry->>'accountCode'),'') is null
      or nullif(btrim(v_entry->>'accountScope'),'') is null
      or coalesce(v_entry->>'direction','') not in ('DEBIT','CREDIT')
      or v_entry->>'currency' is distinct from new.currency::text
      or coalesce(v_entry->>'amount','') !~ '^[1-9][0-9]*$' then
      raise exception 'Refund ledger allocation has an invalid entry';
    end if;
    v_amount := (v_entry->>'amount')::numeric;
    if v_amount>2147483647 then
      raise exception 'Refund ledger entry exceeds integer minor units';
    end if;
    if v_entry->>'direction'='DEBIT' then
      v_debits := v_debits+v_amount;
    else
      v_credits := v_credits+v_amount;
      if v_entry->>'accountCode'<>'PROVIDER_CLEARING' then
        raise exception 'Refund ledger has an unexpected credit account';
      end if;
      v_provider_credits := v_provider_credits+1;
    end if;
  end loop;
  if v_debits<>new.refund_amount or v_credits<>new.refund_amount
    or v_provider_credits<>1 then
    raise exception 'Refund ledger allocation does not match the provider refund';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.validate_order_payment_refund_ledger_snapshot() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_order_payment_refund_ledger_snapshot() TO service_role;
