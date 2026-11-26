-- S3 UUID-safe forward repair from current Dev/main definitions. Historical S3 versions are not replayed.
do $guard$
declare v_environment text; v_project_ref text;
begin
  select environment, project_ref into v_environment, v_project_ref
  from public.ops_runtime_configuration where singleton is true;
  if (v_environment, v_project_ref) not in
    (('DEVELOPMENT','pqptfuqogvrajozfsqzi'),('PRODUCTION','wkfsrunetmgjdtcurmoj')) then
    raise exception 'PHASE4_S3_PROJECT_GUARD';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations
                 where version='20261126080246') then
    raise exception 'PHASE4_S3_DEFAULT_ACL_PREREQUISITE';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public'
                   and table_name='payout_provider_operations'
                   and column_name='provider_source_transaction_id') then
    raise exception 'PHASE4_S3_S1_SOURCE_COLUMN_PREREQUISITE';
  end if;
end;
$guard$;

create table if not exists public.payout_claim_retry_authorizations (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.payout_claims(id) on delete restrict,
  prior_operation_id uuid not null references public.payout_provider_operations(id) on delete restrict,
  money_desk_request_id uuid not null unique references public.money_desk_requests(id) on delete restrict,
  operation_number integer not null check (operation_number between 2 and 3),
  provider text not null check (provider = 'STRIPE'),
  provider_destination_id text not null check (btrim(provider_destination_id) <> ''),
  currency public.currency not null,
  amount integer not null check (amount > 0),
  provider_source_transaction_id text not null check (btrim(provider_source_transaction_id) <> ''),
  final_failure_reference text not null check (btrim(final_failure_reference) <> ''),
  funds_return_reference text not null check (funds_return_reference like 'NOT_SENT:%'),
  created_at timestamptz not null default now(),
  unique (claim_id, operation_number),
  unique (prior_operation_id)
);

alter table public.payout_claim_retry_authorizations enable row level security;
revoke all on public.payout_claim_retry_authorizations from public, anon, authenticated;
grant select, insert on public.payout_claim_retry_authorizations to service_role;

alter table public.payout_provider_operations
  add column if not exists reviewed_retry_id uuid unique
    references public.payout_claim_retry_authorizations(id) on delete restrict;

do $check$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.payout_provider_operations'::regclass
      and c.conname='payout_provider_operations_check'
      and pg_get_constraintdef(c.oid) like '%reviewed_retry_id%'
  ) then
    alter table public.payout_provider_operations
      add constraint payout_provider_operations_retry_forward_check check (
        (operation_number = 1 and reviewed_correction_id is null
          and reviewed_retry_id is null and money_desk_request_id is null)
        or
        (operation_number > 1 and money_desk_request_id is not null
          and ((reviewed_correction_id is not null and reviewed_retry_id is null)
            or (reviewed_correction_id is null and reviewed_retry_id is not null)))
      ) not valid;
    alter table public.payout_provider_operations
      validate constraint payout_provider_operations_retry_forward_check;
    alter table public.payout_provider_operations
      drop constraint payout_provider_operations_check;
    alter table public.payout_provider_operations
      rename constraint payout_provider_operations_retry_forward_check
      to payout_provider_operations_check;
  end if;
end;
$check$;

-- Current Dev definition: payment_internal.tranche_source_payment_available(uuid,uuid,uuid); absent from Production at preflight.
CREATE OR REPLACE FUNCTION payment_internal.tranche_source_payment_available(p_payment_id uuid, p_plan_id uuid, p_tranche_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_payment public.order_payments%rowtype;
  v_plan public.order_settlement_plans%rowtype;
  v_capture_id uuid;
  v_provider_count integer;
  v_provider_amount bigint;
  v_journal_count integer;
  v_journal_amount bigint;
  v_other_claimed bigint;
  v_tranche_amount integer;
begin
  select * into v_payment from public.order_payments where id=p_payment_id;
  select * into v_plan from public.order_settlement_plans where id=p_plan_id;
  if v_payment.id is null or v_plan.id is null
    or v_plan.source_payment_id is distinct from v_payment.id
    or v_plan.order_id is distinct from v_payment.order_id::text
    or v_plan.currency is distinct from v_payment.currency
    or v_payment.phase <> 'INITIAL_ORDER'
    or v_payment.status not in ('SUCCEEDED','PARTIAL_REFUND')
    or v_payment.ledger_recorded_at is null
    or v_payment.refunded_amount is null
    or v_payment.refunded_amount < 0
    or v_payment.refunded_amount > v_payment.amount then
    return false;
  end if;
  if p_tranche_id is not null then
    select amount into v_tranche_amount from public.order_settlement_tranches
      where id=p_tranche_id and plan_id=p_plan_id;
    if v_tranche_amount is null then return false; end if;
    select coalesce(sum(t.amount),0) into v_other_claimed
      from public.order_settlement_tranches t
      where t.plan_id=p_plan_id and t.id<>p_tranche_id
        and (t.status='RELEASED' or exists (
          select 1 from public.payout_claims c
          where c.business_key='tranche:'||t.id::text
            and c.source_kind='SETTLEMENT_TRANCHE'
        ));
    if v_plan.entitlement_amount - v_other_claimed < v_tranche_amount then
      return false;
    end if;
  end if;

  -- A fee or delivery refund may use the same captured charge, but it may
  -- not consume the subtotal reserved for tailor work and fabric.
  if v_payment.amount::bigint - v_payment.refunded_amount < greatest(
      v_plan.seller_subtotal_amount::bigint,
      v_plan.entitlement_amount::bigint + v_plan.excluded_fabric_allowance_amount
    ) then
    return false;
  end if;
  select id into v_capture_id from public.commercial_ledger_transactions
    where payment_id=p_payment_id and order_id=v_plan.order_id
      and transaction_kind='CAPTURE' and purpose='INITIAL_ORDER';
  if v_capture_id is null or (
    select count(*) from public.commercial_ledger_transactions
    where payment_id=p_payment_id and order_id=v_plan.order_id
      and transaction_kind='CAPTURE' and purpose='INITIAL_ORDER'
  )<>1 then return false; end if;

  select count(*),coalesce(sum(amount),0)
    into v_provider_count,v_provider_amount
    from public.order_payment_provider_refunds
    where payment_id=p_payment_id and status='CONFIRMED';
  select count(*),coalesce(sum(original_amount),0)
    into v_journal_count,v_journal_amount
    from public.commercial_ledger_transactions
    where payment_id=p_payment_id and transaction_kind='REFUND'
      and not exists (select 1 from public.commercial_ledger_transactions rv
        where rv.transaction_kind='REVERSAL' and rv.reversal_of_transaction_id=public.commercial_ledger_transactions.id);
  if v_provider_count<>v_journal_count
    or v_provider_amount<>v_journal_amount
    or v_provider_amount<>v_payment.refunded_amount
    or (v_payment.refunded_amount=0 and v_payment.status<>'SUCCEEDED')
    or (v_payment.refunded_amount>0 and v_payment.status<>'PARTIAL_REFUND') then
    return false;
  end if;
  if v_payment.refunded_amount=0 then return true; end if;

  -- Match every confirmed provider refund to one exact journal, and every
  -- journal back to one provider refund. A missing or duplicate receipt
  -- cannot be treated as a harmless non-tailor refund.
  if exists (
    select 1 from public.order_payment_provider_refunds r
    where r.payment_id=p_payment_id and r.status='CONFIRMED'
      and (r.provider is distinct from v_payment.provider
        or (select count(*) from public.commercial_ledger_transactions l
        where l.payment_id=p_payment_id and l.transaction_kind='REFUND'
          and not exists (select 1 from public.commercial_ledger_transactions rv
            where rv.transaction_kind='REVERSAL' and rv.reversal_of_transaction_id=l.id)
          and l.provider_reference=r.provider_refund_id
          and l.original_amount=r.amount and l.settlement_amount=r.amount
          and l.original_currency=v_payment.currency
          and l.settlement_currency=v_payment.currency
          and l.reversal_of_transaction_id=v_capture_id)<>1)
  ) or exists (
    select 1 from public.commercial_ledger_transactions l
    where l.payment_id=p_payment_id and l.transaction_kind='REFUND'
          and not exists (select 1 from public.commercial_ledger_transactions rv
            where rv.transaction_kind='REVERSAL' and rv.reversal_of_transaction_id=l.id)
      and (l.order_id is distinct from v_plan.order_id
        or l.original_currency is distinct from v_payment.currency
        or l.settlement_currency is distinct from v_payment.currency
        or l.reversal_of_transaction_id is distinct from v_capture_id
        or l.original_amount is distinct from l.settlement_amount
        or l.original_amount<=0
        or (select count(*) from public.order_payment_provider_refunds r
          where r.payment_id=p_payment_id and r.status='CONFIRMED'
            and r.provider=v_payment.provider
            and r.provider_refund_id=l.provider_reference
            and r.amount=l.original_amount)<>1)
  ) then
    return false;
  end if;

  -- The exact journal must reverse only fulfillment, tax, duty or platform
  -- fee liabilities. Tailor entitlement/eligibility and unclassified debits
  -- are never available for a routine tranche release.
  if exists (
    select 1 from public.commercial_ledger_transactions l
    where l.payment_id=p_payment_id and l.transaction_kind='REFUND'
          and not exists (select 1 from public.commercial_ledger_transactions rv
            where rv.transaction_kind='REVERSAL' and rv.reversal_of_transaction_id=l.id)
      and (exists (
        select 1 from public.commercial_ledger_entries e
        where e.transaction_id=l.id
          and (e.currency is distinct from v_payment.currency
            or not ((e.direction='DEBIT' and e.account_code in (
              'FULFILLMENT_LIABILITY','TAX_LIABILITY',
              'IMPORT_TAX_LIABILITY','DUTY_LIABILITY','DRAPEON_REVENUE'))
              or (e.direction='CREDIT' and e.account_code='PROVIDER_CLEARING')))
      ) or (select coalesce(sum(e.amount),0) from public.commercial_ledger_entries e
        where e.transaction_id=l.id and e.direction='DEBIT')<>l.original_amount
        or (select coalesce(sum(e.amount),0) from public.commercial_ledger_entries e
        where e.transaction_id=l.id and e.direction='CREDIT')<>l.original_amount)
  ) then
    return false;
  end if;
  return true;
end $function$;
revoke all on function payment_internal.tranche_source_payment_available(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function payment_internal.tranche_source_payment_available(uuid,uuid,uuid) to service_role;

-- Current Dev definition: public.apply_reviewed_claimed_payout_retry(uuid,text,text); absent from Production at preflight.
CREATE OR REPLACE FUNCTION public.apply_reviewed_claimed_payout_retry(p_money_desk_request_id uuid, p_actor_email text, p_actor_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request public.money_desk_requests%rowtype;
  v_attempt public.money_desk_execution_attempts%rowtype;
  v_claim public.payout_claims%rowtype;
  v_previous public.payout_provider_operations%rowtype;
  v_payout public.payouts%rowtype;
  v_tranche public.order_settlement_tranches%rowtype;
  v_existing public.payout_claim_retry_authorizations%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_next_number integer;
  v_order public.orders%rowtype;
  v_payment public.order_payments%rowtype;
  v_plan public.order_settlement_plans%rowtype;
  v_source_payment_id uuid;
begin
  if nullif(btrim(p_actor_email),'') is null
    or upper(btrim(p_actor_role)) not in ('FINANCE','ADMIN') then
    raise exception 'A named Finance or Admin executor is required';
  end if;
  select * into v_request from public.money_desk_requests
    where id=p_money_desk_request_id for update;
  if v_request.id is null
    or v_request.action_type <> 'POST_RELEASE_RECOVERY'
    or v_request.target_type <> 'PAYOUT_CLAIM_RETRY' then
    raise exception 'Money Desk request is not a claimed payout retry';
  end if;
  if v_request.status<>'EXECUTING' then
    raise exception 'Reviewed retry request is no longer executing';
  end if;
  select * into v_existing from public.payout_claim_retry_authorizations
    where money_desk_request_id=v_request.id;
  if v_existing.id is not null then
    select * into v_operation from public.payout_provider_operations
      where reviewed_retry_id=v_existing.id and claim_id=v_existing.claim_id;
    if v_operation.id is null
      or v_operation.operation_number is distinct from v_existing.operation_number
      or v_operation.money_desk_request_id is distinct from v_request.id then
      raise exception 'Reviewed retry authorization has no matching operation';
    end if;
    return jsonb_build_object('outcome','EXISTING','claimId',v_existing.claim_id,
      'operationId',v_operation.id,'operationNumber',v_operation.operation_number,
      'reviewedRetryId',v_existing.id,'providerKey',v_operation.provider_idempotency_key);
  end if;
  select * into v_attempt from public.money_desk_execution_attempts
    where request_id=v_request.id and status='PROCESSING'
    order by id desc limit 1 for update;
  if v_attempt.id is null
    or lower(v_attempt.executor_email) is distinct from lower(btrim(p_actor_email))
    or v_attempt.executor_role is distinct from upper(btrim(p_actor_role)) then
    raise exception 'Executor does not match the active Money Desk attempt';
  end if;
  if v_request.target_id is null
    or v_request.target_id !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'Reviewed retry has no valid payout claim target';
  end if;
  -- Refund reservation locks order, payment, then claim. Take those locks in
  -- the same order so a refund cannot race this retry into a provider send.
  select * into v_order from public.orders
    where id_text=v_request.order_id for update;
  if v_order.id is null then raise exception 'Reviewed retry order is missing'; end if;
  select p.source_payment_id into v_source_payment_id
    from public.payout_claims c join public.payouts p on p.id_text=c.payout_id
    where c.id=v_request.target_id::uuid;
  select * into v_payment from public.order_payments
    where id=v_source_payment_id for update;
  if v_payment.id is null then raise exception 'Reviewed retry source payment is missing'; end if;
  select * into v_claim from public.payout_claims
    where id=v_request.target_id::uuid for update;
  if v_claim.id is null then raise exception 'Reviewed payout claim is missing'; end if;
  if v_claim.source_kind='SETTLEMENT_TRANCHE'
    and v_request.action_payload->>'trancheId' is distinct from v_claim.source_id then
    raise exception 'Reviewed retry is linked to a different settlement tranche';
  end if;
  select * into v_payout from public.payouts
    where id_text=v_claim.payout_id and order_id::text=v_claim.order_id for update;
  if v_payout.id is null or v_payout.status <> 'FAILED'
    or v_payout.payout_purpose is distinct from v_claim.source_kind
    or v_payout.amount is distinct from v_claim.amount
    or v_payout.currency is distinct from v_claim.currency
    or v_payout.provider_destination_id is distinct from v_claim.provider_destination_id
    or v_payout.source_payment_id is distinct from v_payment.id then
    raise exception 'Failed payout no longer matches the reviewed claim';
  end if;
  if v_claim.source_kind = 'SETTLEMENT_TRANCHE' then
    select * into v_tranche from public.order_settlement_tranches
      where id::text=v_claim.source_id and order_id=v_claim.order_id for update;
    if v_tranche.id is null or v_tranche.status <> 'BLOCKED'
      or v_tranche.payout_id is distinct from v_payout.id_text
      or v_tranche.amount is distinct from v_claim.amount
      or v_tranche.currency is distinct from v_claim.currency then
      raise exception 'Blocked tranche no longer matches the failed payout';
    end if;
    select * into v_plan from public.order_settlement_plans
      where id=v_tranche.plan_id;
    if v_plan.id is null or v_plan.status<>'ACTIVE'
      or v_plan.order_id is distinct from v_claim.order_id
      or v_plan.source_payment_id is distinct from v_payment.id
      or v_payment.order_id::text is distinct from v_order.id_text
      or not payment_internal.tranche_source_payment_available(
        v_payment.id,v_plan.id,v_tranche.id)
      or not exists (select 1 from public.order_work_funding_positions pos
        where pos.payout_claim_id=v_claim.id and pos.use_kind='PAYOUT'
          and pos.source_payment_id=v_payment.id
          and pos.amount=v_claim.amount and pos.status='RESERVED')
      or exists (select 1 from public.order_payment_refund_claims rc
        where rc.payment_id=v_payment.id
          and rc.status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING'))
      or exists (select 1 from public.disputes d
        where d.order_id=v_order.id and d.status in ('OPEN','UNDER_REVIEW'))
      or exists (select 1 from public.provider_disputes d
        where d.order_id=v_claim.order_id and d.money_movement_blocked=true) then
      raise exception 'Reviewed retry source is no longer available for payout';
    end if;
  else
    raise exception 'This claimed payout kind has no reviewed retry path';
  end if;
  select * into v_previous from public.payout_provider_operations
    where claim_id=v_claim.id order by operation_number desc limit 1 for update;
  if v_previous.id is null then raise exception 'Prior payout operation is missing'; end if;
  v_next_number := v_previous.operation_number+1;

  -- The insert trigger rechecks the two decisions and all frozen provider
  -- evidence while holding the same request, claim and operation locks.
  insert into public.payout_claim_retry_authorizations (
    claim_id,prior_operation_id,money_desk_request_id,operation_number,
    provider,provider_destination_id,currency,amount,
    provider_source_transaction_id,final_failure_reference,funds_return_reference
  ) values (
    v_claim.id,v_previous.id,v_request.id,v_next_number,
    v_claim.provider,v_claim.provider_destination_id,v_claim.currency,v_claim.amount,
    v_previous.provider_source_transaction_id,v_previous.final_failure_reference,
    v_previous.funds_return_reference
  ) returning * into v_existing;

  insert into public.payout_provider_operations (
    claim_id,operation_number,provider,provider_destination_id,currency,amount,
    provider_idempotency_key,status,provider_source_transaction_id,
    money_desk_request_id,reviewed_retry_id
  ) values (
    v_claim.id,v_next_number,v_claim.provider,v_claim.provider_destination_id,
    v_claim.currency,v_claim.amount,
    v_claim.business_key||':op:'||v_next_number::text,'RESERVED',
    v_previous.provider_source_transaction_id,v_request.id,v_existing.id
  ) returning * into v_operation;

  update public.payout_claims set status='RESERVED',
    transfer_status='NOT_STARTED',withdrawal_status='NOT_STARTED',
    last_provider_checked_at=now()
    where id=v_claim.id and status='FAILED_RECONCILED';
  if not found then raise exception 'Payout claim changed before reviewed retry'; end if;
  update public.payouts set status='PROCESSING',
    provider_transfer_status='PROCESSING',bank_settlement_status='PENDING',
    failed_at=null,completed_at=null,
    provider_response=coalesce(provider_response,'{}'::jsonb)||
      jsonb_build_object('reviewed_retry_id',v_existing.id,
        'supersedes_operation_id',v_previous.id,
        'replacement_operation_number',v_next_number,
        'money_desk_request_id',v_request.id)
    where id=v_payout.id and status='FAILED';
  if not found then raise exception 'Payout row changed before reviewed retry'; end if;
  if v_tranche.id is not null then
    update public.order_settlement_tranches
      set status='RELEASE_REQUESTED',money_desk_request_id=v_request.id,updated_at=now()
      where id=v_tranche.id and status='BLOCKED' and payout_id=v_payout.id_text;
    if not found then raise exception 'Tranche changed before reviewed retry'; end if;
  end if;
  insert into public.money_desk_events (
    request_id,event_type,actor_email,actor_role,payload,correlation_id
  ) values (
    v_request.id,'EXECUTION_STARTED',lower(btrim(p_actor_email)),
    upper(btrim(p_actor_role)),
    jsonb_build_object('step','CLAIMED_PAYOUT_RETRY_RESERVED',
      'claim_id',v_claim.id,'prior_operation_id',v_previous.id,
      'operation_id',v_operation.id,'operation_number',v_next_number,
      'reviewed_retry_id',v_existing.id,'provider_key',v_operation.provider_idempotency_key,
      'money_moved',false),v_request.correlation_id
  );
  return jsonb_build_object('outcome','RETRY_READY','claimId',v_claim.id,
    'operationId',v_operation.id,'operationNumber',v_next_number,
    'reviewedRetryId',v_existing.id,'providerKey',v_operation.provider_idempotency_key);
end;
$function$;
revoke all on function public.apply_reviewed_claimed_payout_retry(uuid,text,text) from public, anon, authenticated;
grant execute on function public.apply_reviewed_claimed_payout_retry(uuid,text,text) to service_role;

-- Current Dev definition: public.close_unstarted_reviewed_claimed_retry(uuid); absent from Production at preflight.
CREATE OR REPLACE FUNCTION public.close_unstarted_reviewed_claimed_retry(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request public.money_desk_requests%rowtype;
  v_attempt public.money_desk_execution_attempts%rowtype;
  v_retry public.payout_claim_retry_authorizations%rowtype;
  v_claim public.payout_claims%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_payout public.payouts%rowtype;
  v_tranche public.order_settlement_tranches%rowtype;
  v_result jsonb;
begin
  select * into v_request from public.money_desk_requests
    where id=p_request_id for update;
  if v_request.id is null
    or v_request.action_type<>'POST_RELEASE_RECOVERY'
    or v_request.target_type<>'PAYOUT_CLAIM_RETRY' then
    raise exception 'Money Desk request is not a claimed payout retry';
  end if;
  if v_request.status<>'EXECUTING' then
    return jsonb_build_object('outcome','ALREADY_TERMINAL','status',v_request.status);
  end if;
  select * into v_retry from public.payout_claim_retry_authorizations
    where money_desk_request_id=v_request.id;
  if v_retry.id is not null then
    select * into v_claim from public.payout_claims
      where id=v_retry.claim_id for update;
    select * into v_operation from public.payout_provider_operations
      where reviewed_retry_id=v_retry.id and claim_id=v_retry.claim_id
      for update;
    select * into v_payout from public.payouts
      where id_text=v_claim.payout_id for update;
    select * into v_tranche from public.order_settlement_tranches
      where id::text=v_claim.source_id for update;
    -- A provider-started retry may later be conclusively rejected without a
    -- transfer. Close its reviewed request only when the durable operation,
    -- claim, payout and tranche all agree that no money was sent.
    if v_claim.id is not null and v_operation.id is not null
      and v_payout.id is not null and v_tranche.id is not null
      and v_operation.money_desk_request_id=v_request.id
      and v_operation.reviewed_retry_id=v_retry.id
      and v_claim.status='FAILED_RECONCILED'
      and v_claim.transfer_status='FAILED_RECONCILED'
      and v_claim.provider_transfer_id is null
      and v_claim.payout_ledger_transaction_id is null
      and v_operation.status='FAILED_RETURNED'
      and v_operation.provider_transfer_id is null
      and nullif(btrim(v_operation.final_failure_reference),'') is not null
      and v_operation.funds_return_reference like 'NOT_SENT:%'
      and v_operation.funds_return_confirmed_at is not null
      and v_payout.status in ('PROCESSING','FAILED')
      and v_payout.provider_payout_id is null
      and v_tranche.status in ('RELEASE_REQUESTED','BLOCKED')
      and v_tranche.money_desk_request_id=v_request.id then
      -- reconcile_definite_payout_rejection updates the claim before the
      -- operation, so the returned-funds trigger cannot see terminal evidence
      -- at that moment. Close the associated payout and tranche here, after
      -- checking the now-durable NOT_SENT operation under the same locks.
      update public.payouts set status='FAILED',failed_at=coalesce(failed_at,now()),
        provider_transfer_status='FAILED',bank_settlement_status='NOT_APPLICABLE',
        provider_response=coalesce(provider_response,'{}'::jsonb)||jsonb_build_object(
          'terminal_outcome','FAILED_RETURNED','claim_id',v_claim.id,
          'claim_operation_id',v_operation.id,
          'final_failure_reference',v_operation.final_failure_reference,
          'funds_return_reference',v_operation.funds_return_reference)
        where id=v_payout.id and status in ('PROCESSING','FAILED');
      update public.order_settlement_tranches set status='BLOCKED',updated_at=now()
        where id=v_tranche.id and status in ('RELEASE_REQUESTED','BLOCKED');
      select * into v_attempt from public.money_desk_execution_attempts
        where request_id=v_request.id and status='PROCESSING'
        order by id desc limit 1 for update;
      if v_attempt.id is null then
        raise exception 'Reviewed retry has no processing Money Desk attempt';
      end if;
      v_result := public.complete_money_desk_execution(
        v_attempt.id,'FAILED',null,'REVIEWED_RETRY_NOT_SENT',
        'Stripe definitively rejected the reviewed transfer; no funds were sent.');
      if v_result->>'status'<>'FAILED' then
        raise exception 'Reviewed retry could not close the rejected attempt';
      end if;
      return jsonb_build_object('outcome','CLOSED_DEFINITE_REJECTION',
        'attemptId',v_attempt.id);
    end if;
    if v_claim.id is null or v_operation.id is null or v_payout.id is null
      or v_tranche.id is null
      or v_claim.status<>'RESERVED' or v_claim.transfer_status<>'NOT_STARTED'
      or v_claim.provider_transfer_id is not null
      or v_operation.status<>'RESERVED' or v_operation.provider_transfer_id is not null
      or v_operation.money_desk_request_id is distinct from v_request.id
      or v_payout.status<>'PROCESSING' or v_tranche.status<>'RELEASE_REQUESTED'
      or v_tranche.payout_id is distinct from v_payout.id_text
      or v_tranche.money_desk_request_id is distinct from v_request.id
      or exists (select 1 from public.payout_attempts pa
        where pa.claim_operation_id=v_operation.id) then
      return jsonb_build_object('outcome','PROVIDER_OPERATION_POSSIBLE');
    end if;
    update public.payout_provider_operations set
      status='FAILED_RETURNED',
      final_failure_reference='LOCAL_PRE_PROVIDER_ABORT',
      funds_return_reference='NOT_SENT:LOCAL_PRE_PROVIDER_ABORT',
      funds_return_confirmed_at=now()
      where id=v_operation.id and status='RESERVED';
    update public.payout_claims set
      status='FAILED_RECONCILED',transfer_status='FAILED_RECONCILED',
      last_provider_checked_at=now()
      where id=v_claim.id and status='RESERVED';
    update public.payouts set status='FAILED',failed_at=now(),
      provider_transfer_status='FAILED',bank_settlement_status='BLOCKED'
      where id=v_payout.id and status='PROCESSING';
    update public.order_settlement_tranches set status='BLOCKED',updated_at=now()
      where id=v_tranche.id and status='RELEASE_REQUESTED';
    -- The existing returned-funds trigger may open the tranche reconciliation
    -- case when the claim closes. Give Ops the precise no-provider outcome.
    insert into public.ops_issues as issue (
      issue_type,severity,status,source,order_id,related_entity_type,
      related_entity_id,provider,title,description,recommended_action,
      dedupe_key,metadata
    ) values (
      'PAYOUT_FAILED','HIGH','OPEN','reviewed-claimed-payout-retry',
      v_claim.order_id,'PAYOUT_CLAIM',v_claim.id::text,v_claim.provider,
      'Reviewed payout retry stopped before Stripe',
      'The reviewed attempt stopped before a provider attempt or transfer was created. The earning remains unpaid.',
      'Review the changed source payment or failed preflight before preparing a new two-person request. Do not send a manual transfer.',
      lower(v_claim.provider)||'-tranche-reconcile:'||v_claim.source_id,
      jsonb_build_object('claim_id',v_claim.id,'operation_id',v_operation.id,
        'money_desk_request_id',v_request.id,'terminal_outcome','NOT_SENT_LOCAL_ABORT')
    ) on conflict (dedupe_key) do update set
      status='OPEN',source=excluded.source,title=excluded.title,
      description=excluded.description,recommended_action=excluded.recommended_action,
      metadata=coalesce(issue.metadata,'{}'::jsonb)||excluded.metadata,
      last_seen_at=now();
  elsif exists (select 1 from public.payout_provider_operations op
      where op.money_desk_request_id=v_request.id) then
    return jsonb_build_object('outcome','PROVIDER_OPERATION_POSSIBLE');
  end if;
  select * into v_attempt from public.money_desk_execution_attempts
    where request_id=v_request.id and status='PROCESSING'
    order by id desc limit 1 for update;
  if v_attempt.id is null then
    raise exception 'Reviewed retry has no processing Money Desk attempt';
  end if;
  v_result := public.complete_money_desk_execution(
    v_attempt.id,'FAILED',null,'REVIEWED_RETRY_NO_OPERATION',
    'The approved retry stopped before any provider operation was reserved.');
  if v_result->>'status'<>'FAILED' then
    raise exception 'Reviewed retry could not close the unstarted attempt';
  end if;
  return jsonb_build_object('outcome','CLOSED_NO_OPERATION',
    'attemptId',v_attempt.id);
end;
$function$;
revoke all on function public.close_unstarted_reviewed_claimed_retry(uuid) from public, anon, authenticated;
grant execute on function public.close_unstarted_reviewed_claimed_retry(uuid) to service_role;

-- Current Dev definition: public.close_unstarted_settlement_tranche_payout(uuid,text,text); absent from Production at preflight.
CREATE OR REPLACE FUNCTION public.close_unstarted_settlement_tranche_payout(p_claim_id uuid, p_failure_code text, p_source_transaction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_claim public.payout_claims%rowtype;
  v_order_id text;
  v_tranche public.order_settlement_tranches%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_payout public.payouts%rowtype;
  v_source_charge text;
  v_payment_charge text;
  v_provider_response jsonb;
  v_source_bind_rows integer := 0;
  v_retry_available boolean := false;
BEGIN
  IF p_failure_code NOT IN (
    'PRE_PROVIDER_ABORT',
    'STRIPE_SOURCE_CHARGE_MISSING',
    'PAYOUT_RELEASE_PINNED_DESTINATION_MISSING',
    'PAYOUT_RELEASE_PINNED_DESTINATION_MISMATCH',
    'PAYOUT_RELEASE_STRIPE_REFRESH_NETWORK_ERROR',
    'PAYOUT_RELEASE_STRIPE_REFRESH_FAILED',
    'PAYOUT_RELEASE_DESTINATION_READ_FAILED',
    'PAYOUT_RELEASE_STRIPE_REFRESH_STALE',
    'PAYOUT_RELEASE_STRIPE_CAPABILITY_DISABLED',
    'PAYOUT_RELEASE_REFRESH_EVIDENCE_NOT_RECORDED',
    'PAYOUT_RELEASE_ORDER_READ_FAILED',
    'PAYOUT_RELEASE_STRIPE_SNAPSHOT_MISSING'
  ) THEN
    RAISE EXCEPTION 'Unrecognized pre-provider failure code';
  END IF;

  SELECT order_id INTO v_order_id
  FROM public.payout_claims
  WHERE id = p_claim_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'NOT_SAFE');
  END IF;

  -- Match the release reservation lock order: order, tranche, claim, payout.
  PERFORM 1 FROM public.orders WHERE id_text = v_order_id FOR UPDATE;
  SELECT * INTO v_tranche
  FROM public.order_settlement_tranches
  WHERE order_id = v_order_id
    AND id::text = (SELECT source_id FROM public.payout_claims WHERE id = p_claim_id)
  FOR UPDATE;
  SELECT * INTO v_claim FROM public.payout_claims WHERE id = p_claim_id FOR UPDATE;
  SELECT * INTO v_operation
  FROM public.payout_provider_operations
  WHERE claim_id = v_claim.id AND operation_number = 1
  FOR UPDATE;
  IF v_claim.status = 'FAILED_RECONCILED'
    AND v_claim.transfer_status = 'FAILED_RECONCILED'
    AND v_claim.source_kind = 'SETTLEMENT_TRANCHE'
    AND v_operation.status = 'FAILED_RETURNED'
    AND v_operation.final_failure_reference = 'LOCAL_PRE_PROVIDER_ABORT'
    AND v_tranche.status = 'BLOCKED'
    AND v_tranche.blocked_reason = 'PAYOUT_PRE_PROVIDER_ABORT'
    AND v_operation.funds_return_reference = 'NOT_SENT:LOCAL_PRE_PROVIDER_ABORT'
    AND v_operation.funds_return_confirmed_at IS NOT NULL
  THEN
    RETURN jsonb_build_object('outcome', 'ALREADY_CLOSED', 'claim_id', v_claim.id,
                              'payout_id', v_claim.payout_id,
                              'tranche_id', v_tranche.id,
                              'retry_available', v_claim.provider = 'STRIPE'
                                AND v_operation.provider_source_transaction_id ~ '^ch_[A-Za-z0-9_-]+$');
  END IF;

  SELECT * INTO v_payout FROM public.payouts WHERE id_text = v_claim.payout_id FOR UPDATE;

  IF v_claim.source_kind <> 'SETTLEMENT_TRANCHE'
    OR v_claim.status <> 'RESERVED'
    OR v_claim.transfer_status <> 'NOT_STARTED'
    OR v_claim.provider_transfer_id IS NOT NULL
    OR v_claim.payout_id IS NULL
    OR v_tranche.id IS NULL
    OR v_tranche.status <> 'RELEASE_REQUESTED'
    OR v_tranche.payout_id IS DISTINCT FROM v_claim.payout_id
    OR v_tranche.release_ledger_transaction_id IS NOT NULL
    OR v_claim.payout_ledger_transaction_id IS NOT NULL
    OR v_operation.id IS NULL
    OR v_operation.status <> 'RESERVED'
    OR v_operation.provider_transfer_id IS NOT NULL
    OR v_operation.final_failure_reference IS NOT NULL
    OR v_payout.id IS NULL
    OR v_payout.status <> 'PROCESSING'
    OR v_payout.provider_transfer_status <> 'PROCESSING'
    OR v_payout.provider_payout_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.payout_attempts WHERE claim_id = v_claim.id)
    OR EXISTS (
      SELECT 1 FROM public.commercial_ledger_transactions
      WHERE purpose = 'SETTLEMENT_RELEASE'
        AND metadata->>'tranche_id' = v_tranche.id::text
    )
  THEN
    RETURN jsonb_build_object('outcome', 'NOT_SAFE', 'claim_id', v_claim.id);
  END IF;

  -- Bind only the source charge resolved by the release function, and only
  -- after it matches evidence on the payout's pinned payment. Some imported
  -- Stripe payments store latest_charge only in provider_response.
  IF v_claim.provider = 'STRIPE' AND v_payout.source_payment_id IS NOT NULL THEN
    SELECT provider_charge_id, provider_response
      INTO v_payment_charge, v_provider_response
    FROM public.order_payments
    WHERE id = v_payout.source_payment_id
      AND order_id::text = v_claim.order_id
      AND provider = 'STRIPE'
      AND status IN ('SUCCEEDED', 'PARTIAL_REFUND');
    IF p_source_transaction ~ '^ch_[A-Za-z0-9_-]+$'
      AND (
        v_payment_charge = p_source_transaction
        OR EXISTS (
          SELECT 1
          FROM LATERAL (VALUES
            (v_provider_response->'latest_charge'),
            (v_provider_response->'charge'),
            (v_provider_response->'payment_intent'->'latest_charge'),
            (v_provider_response->'data'->'object'->'latest_charge'),
            (v_provider_response->'data'->'object'->'charge')
          ) AS candidates(value)
          WHERE CASE jsonb_typeof(candidates.value)
            WHEN 'string' THEN candidates.value #>> '{}'
            WHEN 'object' THEN candidates.value->>'id'
            ELSE NULL
          END = p_source_transaction
        )
      ) THEN
      v_source_charge := p_source_transaction;
      PERFORM set_config('app.bind_payout_source_transaction', 'on', true);
      UPDATE public.payout_provider_operations
      SET provider_source_transaction_id = v_source_charge
      WHERE id = v_operation.id
        AND status = 'RESERVED'
        AND provider_source_transaction_id IS NULL;
      GET DIAGNOSTICS v_source_bind_rows = ROW_COUNT;
      PERFORM set_config('app.bind_payout_source_transaction', '', true);
      IF v_source_bind_rows <> 1 THEN
        RAISE EXCEPTION 'Could not bind pinned Stripe source charge for reviewed retry';
      END IF;
      v_retry_available := true;
      SELECT * INTO v_operation FROM public.payout_provider_operations
      WHERE id = v_operation.id;
    END IF;
  END IF;

  UPDATE public.payout_provider_operations
  SET status = 'FAILED_RETURNED',
      final_failure_reference = 'LOCAL_PRE_PROVIDER_ABORT',
      funds_return_reference = 'NOT_SENT:LOCAL_PRE_PROVIDER_ABORT',
      funds_return_confirmed_at = now()
  WHERE id = v_operation.id AND status = 'RESERVED';

  UPDATE public.payout_claims
  SET status = 'FAILED_RECONCILED', transfer_status = 'FAILED_RECONCILED', updated_at = now(),
      last_provider_checked_at = now()
  WHERE id = v_claim.id;

  UPDATE public.payouts
  SET status = 'FAILED', provider_transfer_status = 'FAILED',
      bank_settlement_status = 'BLOCKED', blocked_reason = 'PAYOUT_PRE_PROVIDER_ABORT',
      failed_at = now(), provider_response = coalesce(provider_response, '{}'::jsonb)
        || jsonb_build_object('terminal_outcome', 'NO_PROVIDER_ATTEMPT',
                              'failure_code', p_failure_code,
                              'claim_id', v_claim.id,
                              'claim_operation_id', v_operation.id)
  WHERE id_text = v_claim.payout_id;

  UPDATE public.order_settlement_tranches
  SET status = 'BLOCKED', blocked_reason = 'PAYOUT_PRE_PROVIDER_ABORT', updated_at = now()
  WHERE id = v_tranche.id;

  -- The claim trigger treats every FAILED_RECONCILED tranche as returned funds.
  -- Replace that case in this same transaction: this abort happened before
  -- Stripe was called, so no returned balance or destination correction exists.
  UPDATE public.ops_issues SET
    status = 'OPEN', canonical_status = 'NEW', resolved_at = NULL, closed_at = NULL,
    last_seen_at = now(), source = 'payout-pre-provider-abort',
    title = 'Payout stopped before reaching Stripe',
    description = 'The payout reservation failed before any provider attempt was created. No transfer was sent and no money left Drapeon.',
    recommended_action = CASE WHEN v_retry_available
      THEN 'Resolve the pre-provider failure, then use the reviewed same-destination payout retry. Do not send a manual transfer.'
      WHEN v_claim.provider = 'STRIPE'
        THEN 'A reviewed Stripe retry is unavailable until Ops verifies the original source charge against the payment record. Do not send a manual transfer.'
      ELSE 'No reviewed retry path is available for this provider. Ops must reconcile the route before any new payout action. Do not send a manual transfer.'
      END,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'claim_id', v_claim.id, 'payout_id', v_claim.payout_id,
      'operation_id', v_operation.id, 'failure_code', p_failure_code,
      'terminal_outcome', 'NO_PROVIDER_ATTEMPT',
      'retry_available', v_retry_available)
  WHERE dedupe_key = lower(v_claim.provider) || '-tranche-reconcile:' || v_claim.source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pre-provider close did not create its tranche Ops case';
  END IF;

  RETURN jsonb_build_object('outcome', 'ABORTED', 'claim_id', v_claim.id,
                            'payout_id', v_claim.payout_id,
                            'tranche_id', v_tranche.id,
                            'retry_available', v_retry_available);
END;
$function$;
revoke all on function public.close_unstarted_settlement_tranche_payout(uuid,text,text) from public, anon, authenticated;
grant execute on function public.close_unstarted_settlement_tranche_payout(uuid,text,text) to service_role;

-- Current Dev definition: public.load_reviewed_claimed_tranche_retry(uuid,uuid,text,text,text); absent from Production at preflight.
CREATE OR REPLACE FUNCTION public.load_reviewed_claimed_tranche_retry(p_tranche_id uuid, p_money_desk_request_id uuid, p_provider text, p_destination_id text, p_source_transaction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request public.money_desk_requests%rowtype;
  v_retry public.payout_claim_retry_authorizations%rowtype;
  v_claim public.payout_claims%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_payout public.payouts%rowtype;
  v_tranche public.order_settlement_tranches%rowtype;
begin
  select * into v_request from public.money_desk_requests
    where id=p_money_desk_request_id;
  select * into v_retry from public.payout_claim_retry_authorizations
    where money_desk_request_id=p_money_desk_request_id;
  select * into v_claim from public.payout_claims where id=v_retry.claim_id;
  select * into v_operation from public.payout_provider_operations
    where reviewed_retry_id=v_retry.id and claim_id=v_claim.id;
  select * into v_payout from public.payouts where id_text=v_claim.payout_id;
  select * into v_tranche from public.order_settlement_tranches
    where id=p_tranche_id;
  if v_request.id is null or v_retry.id is null or v_claim.id is null
    or v_operation.id is null or v_payout.id is null or v_tranche.id is null
    or v_request.status<>'EXECUTING'
    or v_request.action_type<>'POST_RELEASE_RECOVERY'
    or v_request.target_type<>'PAYOUT_CLAIM_RETRY'
    or v_request.target_id is distinct from v_claim.id::text
    or v_request.order_id is distinct from v_claim.order_id
    or v_request.amount is distinct from v_claim.amount
    or v_request.currency is distinct from v_claim.currency
    or v_claim.source_kind<>'SETTLEMENT_TRANCHE'
    or v_claim.source_id is distinct from p_tranche_id::text
    or v_claim.status not in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING')
    or (v_claim.status='RESERVED' and v_claim.transfer_status<>'NOT_STARTED')
    or (v_claim.status='PROVIDER_UNKNOWN' and v_claim.transfer_status<>'UNKNOWN')
    or (v_claim.status='PROVIDER_PENDING' and v_claim.transfer_status<>'PENDING')
    or v_claim.provider is distinct from p_provider
    or v_claim.provider_destination_id is distinct from p_destination_id
    or v_claim.payout_id is distinct from v_payout.id_text
    or v_operation.operation_number is distinct from v_retry.operation_number
    or v_operation.status is distinct from v_claim.status
    or v_operation.provider_transfer_id is distinct from v_claim.provider_transfer_id
    or v_operation.provider_idempotency_key is distinct from
      v_claim.business_key||':op:'||v_operation.operation_number::text
    or v_operation.money_desk_request_id is distinct from v_request.id
    or v_operation.provider_source_transaction_id is distinct from p_source_transaction
    or v_operation.provider_destination_id is distinct from p_destination_id
    or v_operation.amount is distinct from v_claim.amount
    or v_operation.currency is distinct from v_claim.currency
    or v_payout.status<>'PROCESSING'
    or v_payout.payout_purpose<>'SETTLEMENT_TRANCHE'
    or v_payout.settlement_tranche_id is distinct from v_tranche.id
    or v_payout.order_id::text is distinct from v_claim.order_id
    or v_payout.amount is distinct from v_claim.amount
    or v_payout.currency is distinct from v_claim.currency
    or v_payout.provider_destination_id is distinct from p_destination_id
    or v_tranche.status<>'RELEASE_REQUESTED'
    or v_tranche.order_id is distinct from v_claim.order_id
    or v_tranche.payout_id is distinct from v_payout.id_text
    or v_tranche.money_desk_request_id is distinct from v_request.id
    or v_tranche.amount is distinct from v_claim.amount
    or v_tranche.currency is distinct from v_claim.currency then
    raise exception 'Reviewed tranche retry no longer matches its active payout';
  end if;
  return jsonb_build_object(
    'outcome','EXISTING','claim_id',v_claim.id,'payout_id',v_payout.id,
    'status',v_claim.status,'provider_idempotency_key',v_claim.provider_idempotency_key,
    'provider_transfer_id',v_claim.provider_transfer_id,
    'operation_id',v_operation.id,'operation_number',v_operation.operation_number,
    'reviewed_retry_id',v_retry.id,'source_payment_changed',false
  );
end;
$function$;
revoke all on function public.load_reviewed_claimed_tranche_retry(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.load_reviewed_claimed_tranche_retry(uuid,uuid,text,text,text) to service_role;

-- Current Dev definition: public.prevent_payout_claim_retry_authorization_rewrite(); absent from Production at preflight.
CREATE OR REPLACE FUNCTION public.prevent_payout_claim_retry_authorization_rewrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'Reviewed claimed-payout retry authorization is immutable';
end;
$function$;
revoke all on function public.prevent_payout_claim_retry_authorization_rewrite() from public, anon, authenticated;
grant execute on function public.prevent_payout_claim_retry_authorization_rewrite() to service_role;

-- Current Dev definition: public.reconcile_definite_payout_rejection(uuid,uuid,jsonb); absent from Production at preflight.
CREATE OR REPLACE FUNCTION public.reconcile_definite_payout_rejection(p_claim_id uuid, p_attempt_id uuid, p_reconciliation_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_attempt public.payout_attempts%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_prior public.payout_attempts%rowtype;
  v_payout public.payouts%rowtype;
  v_tranche public.order_settlement_tranches%rowtype;
  v_issue_id uuid;
begin
  if p_reconciliation_evidence is null
    or jsonb_typeof(p_reconciliation_evidence) <> 'object'
    or p_reconciliation_evidence->>'provider' is distinct from 'STRIPE'
    or p_reconciliation_evidence->>'reason' is distinct from 'no_transfer_found_for_operation'
  then
    return jsonb_build_object('outcome','NOT_DEFINITE');
  end if;

  select * into v_claim from public.payout_claims
    where id=p_claim_id for update;
  select * into v_attempt from public.payout_attempts
    where id=p_attempt_id and claim_id=p_claim_id for update;
  if v_claim.id is null or v_attempt.id is null
    or v_claim.status <> 'PROVIDER_UNKNOWN'
    or v_claim.provider_transfer_id is not null
    or v_attempt.status <> 'PREPARED'
    or v_attempt.claim_operation_id is null
  then
    return jsonb_build_object('outcome','NOT_DEFINITE');
  end if;
  select * into v_operation from public.payout_provider_operations
    where id=v_attempt.claim_operation_id and claim_id=p_claim_id for update;
  if v_operation.id is null or v_operation.provider <> 'STRIPE'
    or v_operation.status <> 'PROVIDER_UNKNOWN'
    or v_operation.provider_transfer_id is not null
    or v_operation.final_failure_reference is not null
    or v_operation.funds_return_reference is not null
    or v_operation.funds_return_confirmed_at is not null
  then
    return jsonb_build_object('outcome','NOT_DEFINITE');
  end if;

  select * into v_prior from public.payout_attempts
    where claim_id=p_claim_id
      and claim_operation_id=v_operation.id
      and id<>p_attempt_id
      and provider_evidence->>'definite_rejection'='true'
      and nullif(btrim(provider_evidence->>'stripe_code'),'') is not null
    order by attempt_number desc limit 1 for update;
  if v_prior.id is null then
    return jsonb_build_object('outcome','NOT_DEFINITE');
  end if;
  if nullif(btrim(v_prior.provider_evidence->>'stripe_request_id'),'') is null
    or exists (
      select 1 from public.payout_provider_operations other
      where other.claim_id=v_claim.id and other.id<>v_operation.id
        and other.status in ('TRANSFERRED','WITHDRAWN','LATE_SUCCEEDED')
    )
  then
    return jsonb_build_object('outcome','NOT_DEFINITE');
  end if;

  update public.payout_attempts set
    status='FAILED_RECONCILED',
    provider_evidence=p_reconciliation_evidence||jsonb_build_object(
      'definite_rejection',true,
      'stripe_code',v_prior.provider_evidence->>'stripe_code',
      'stripe_request_id',v_prior.provider_evidence->>'stripe_request_id',
      'rejected_attempt_id',v_prior.id),
    completed_at=now()
  where id=v_attempt.id;

  update public.payout_provider_operations set
    status='FAILED_RETURNED',
    final_failure_reference=v_prior.provider_evidence->>'stripe_request_id',
    funds_return_reference='NOT_SENT:'||(v_prior.provider_evidence->>'stripe_code'),
    funds_return_confirmed_at=now()
  where id=v_operation.id;

  update public.payout_claims set
    status='FAILED_RECONCILED',transfer_status='FAILED_RECONCILED',
    last_provider_checked_at=now()
  where id=v_claim.id;

  if v_claim.source_kind='SETTLEMENT_TRANCHE' then
    -- The claim trigger has now seen the final operation and closed the payout.
    -- Keep the tranche in the same terminal state so a new reviewed recovery
    -- can be prepared. A mismatch rolls back the entire reconciliation.
    select * into v_payout from public.payouts
      where id_text=v_claim.payout_id for update;
    select * into v_tranche from public.order_settlement_tranches
      where id::text=v_claim.source_id for update;
    if v_payout.id is null or v_tranche.id is null
      or v_payout.status<>'FAILED'
      or v_payout.provider_payout_id is not null
      or v_payout.provider_response->>'terminal_outcome' is distinct from 'FAILED_RETURNED'
      or v_payout.provider_response->>'claim_operation_id' is distinct from v_operation.id::text
      or v_payout.order_id::text is distinct from v_claim.order_id
      or v_payout.amount is distinct from v_claim.amount
      or v_payout.currency is distinct from v_claim.currency
      or v_tranche.status<>'RELEASE_REQUESTED'
      or v_tranche.order_id is distinct from v_claim.order_id
      or v_tranche.payout_id is distinct from v_payout.id_text
      or v_tranche.amount is distinct from v_claim.amount
      or v_tranche.currency is distinct from v_claim.currency
      or v_claim.payout_ledger_transaction_id is not null then
      raise exception 'Rejected tranche did not reach a safe unpaid payout state';
    end if;
    update public.order_settlement_tranches set status='BLOCKED',updated_at=now()
      where id=v_tranche.id and status='RELEASE_REQUESTED';
    if not found then
      raise exception 'Rejected tranche changed before close-out';
    end if;
    -- The claim trigger already created the tranche case. Correct its returned-
    -- funds wording for NOT_SENT evidence instead of opening a second case.
    update public.ops_issues set
      status='OPEN',canonical_status='NEW',resolved_at=null,closed_at=null,
      last_seen_at=now(),source='payout-definite-rejection',
      title='Stripe payout was rejected before a transfer was created',
      description='Stripe returned a definite rejection and the exact operation lookup found no transfer. No funds left Drapeon.',
      recommended_action='After Stripe capability is restored, use the reviewed claimed-payout retry for this destination. If payout details must change, use the reviewed destination-correction workflow. Never reuse the rejected operation key or send a manual transfer.',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'claim_id',v_claim.id,'operation_id',v_operation.id,
        'attempt_id',v_attempt.id,'rejected_attempt_id',v_prior.id,
        'stripe_code',v_prior.provider_evidence->>'stripe_code',
        'stripe_request_id',v_prior.provider_evidence->>'stripe_request_id',
        'terminal_outcome','NOT_SENT')
    where dedupe_key=lower(v_claim.provider)||'-tranche-reconcile:'||v_claim.source_id;
    if not found then
      raise exception 'Definite tranche rejection did not create its Ops case';
    end if;
    select id into v_issue_id from public.ops_issues
      where dedupe_key=lower(v_claim.provider)||'-tranche-reconcile:'||v_claim.source_id;
  else
    insert into public.ops_issues (
    issue_type,severity,status,source,order_id,related_entity_type,
    related_entity_id,provider,title,description,recommended_action,
    dedupe_key,metadata
  ) values (
    'PAYOUT_FAILED','HIGH','OPEN','payout-definite-rejection',v_claim.order_id,
    'PAYOUT_CLAIM',v_claim.id::text,'STRIPE',
    'Stripe payout was rejected before a transfer was created',
    'Stripe returned a definite rejection and the later exact operation lookup found no transfer.',
    'Keep this earning blocked while Ops reviews the provider rejection. Do not reuse the rejected operation key or send a manual transfer.',
    'payout-definite-rejection:'||v_operation.id::text,
    jsonb_build_object('claim_id',v_claim.id,'operation_id',v_operation.id,
      'attempt_id',v_attempt.id,'rejected_attempt_id',v_prior.id,
      'stripe_code',v_prior.provider_evidence->>'stripe_code',
      'stripe_request_id',v_prior.provider_evidence->>'stripe_request_id')
    ) on conflict (dedupe_key) do update set
      status='OPEN',last_seen_at=now(),metadata=excluded.metadata
    returning id into v_issue_id;
  end if;

  return jsonb_build_object('outcome','FAILED_RECONCILED',
    'claim_id',v_claim.id,'attempt_id',v_attempt.id,'ops_issue_id',v_issue_id);
end;
$function$;
revoke all on function public.reconcile_definite_payout_rejection(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.reconcile_definite_payout_rejection(uuid,uuid,jsonb) to service_role;

-- Current Dev definition: public.validate_payout_claim_retry_authorization(); absent from Production at preflight.
CREATE OR REPLACE FUNCTION public.validate_payout_claim_retry_authorization()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request public.money_desk_requests%rowtype;
  v_claim public.payout_claims%rowtype;
  v_previous public.payout_provider_operations%rowtype;
  v_approval_rows integer;
  v_distinct_approvers integer;
begin
  select * into v_request from public.money_desk_requests
    where id=new.money_desk_request_id for update;
  if v_request.id is null
    or v_request.action_type <> 'POST_RELEASE_RECOVERY'
    or v_request.target_type <> 'PAYOUT_CLAIM_RETRY'
    or v_request.target_id is distinct from new.claim_id::text
    or v_request.status <> 'EXECUTING'
    or v_request.approved_at is null
    or v_request.required_approval_count <> 2
    or v_request.approval_count <> 2
    or nullif(btrim(v_request.requester_subject),'') is null
    or not exists (select 1 from public.money_desk_execution_attempts e
      where e.request_id=v_request.id and e.status='PROCESSING') then
    raise exception 'Claimed payout retry requires an executing two-person Money Desk request';
  end if;
  select count(*),count(distinct d.approver_subject)
    into v_approval_rows,v_distinct_approvers
    from public.money_desk_decisions d
    where d.request_id=v_request.id and d.decision='APPROVE'
      and nullif(btrim(d.approver_subject),'') is not null
      and d.approver_subject is distinct from v_request.requester_subject;
  if v_approval_rows <> 2 or v_distinct_approvers <> 2 then
    raise exception 'Claimed payout retry needs two distinct non-requester approvers';
  end if;

  select * into v_claim from public.payout_claims
    where id=new.claim_id for update;
  select * into v_previous from public.payout_provider_operations
    where id=new.prior_operation_id and claim_id=new.claim_id for update;
  if v_claim.id is null or v_previous.id is null
    or v_claim.provider <> 'STRIPE'
    or v_claim.source_kind <> 'SETTLEMENT_TRANCHE'
    or v_claim.status <> 'FAILED_RECONCILED'
    or v_claim.transfer_status <> 'FAILED_RECONCILED'
    or v_claim.provider_transfer_id is not null
    or v_previous.status <> 'FAILED_RETURNED'
    or v_previous.provider_transfer_id is not null
    or nullif(btrim(v_previous.final_failure_reference),'') is null
    or v_previous.funds_return_reference not like 'NOT_SENT:%'
    or v_previous.funds_return_confirmed_at is null
    or nullif(btrim(v_previous.provider_source_transaction_id),'') is null
    or v_previous.operation_number + 1 is distinct from new.operation_number
    or new.operation_number not between 2 and 3
    or exists (select 1 from public.payout_provider_operations other
      where other.claim_id=new.claim_id and other.operation_number>v_previous.operation_number)
    or exists (select 1 from public.payout_provider_operations other
      where other.claim_id=new.claim_id and other.id<>v_previous.id
        and (other.provider_transfer_id is not null
          or other.status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING',
            'TRANSFERRED','WITHDRAWN','LATE_SUCCEEDED'))) then
    raise exception 'Claimed payout is not a definite not-sent rejection';
  end if;
  if row(new.provider,new.provider_destination_id,new.currency,new.amount,
      new.provider_source_transaction_id,new.final_failure_reference,new.funds_return_reference)
    is distinct from row(v_claim.provider,v_claim.provider_destination_id,v_claim.currency,
      v_claim.amount,v_previous.provider_source_transaction_id,
      v_previous.final_failure_reference,v_previous.funds_return_reference)
    or v_previous.provider is distinct from v_claim.provider
    or v_previous.provider_destination_id is distinct from v_claim.provider_destination_id
    or v_previous.currency is distinct from v_claim.currency
    or v_previous.amount is distinct from v_claim.amount
    or v_request.order_id is distinct from v_claim.order_id
    or v_request.amount is distinct from v_claim.amount
    or v_request.currency is distinct from v_claim.currency
    or v_request.action_payload->>'claimId' is distinct from v_claim.id::text
    or (v_claim.source_kind='SETTLEMENT_TRANCHE' and
      v_request.action_payload->>'trancheId' is distinct from v_claim.source_id)
    or v_request.action_payload->>'priorOperationId' is distinct from v_previous.id::text
    or v_request.action_payload->>'provider' is distinct from v_claim.provider
    or v_request.action_payload->>'destinationId' is distinct from v_claim.provider_destination_id
    or v_request.action_payload->>'sourceTransaction' is distinct from v_previous.provider_source_transaction_id
    or v_request.action_payload->>'finalFailureReference' is distinct from v_previous.final_failure_reference
    or v_request.action_payload->>'fundsReturnReference' is distinct from v_previous.funds_return_reference then
    raise exception 'Claimed payout retry differs from the approved order, amount or provider evidence';
  end if;
  return new;
end;
$function$;
revoke all on function public.validate_payout_claim_retry_authorization() from public, anon, authenticated;
grant execute on function public.validate_payout_claim_retry_authorization() to service_role;

do $triggers$
begin
  if not exists (select 1 from pg_trigger where tgrelid='public.payout_claim_retry_authorizations'::regclass
      and tgname='validate_payout_claim_retry_authorization_before_insert') then
    create trigger validate_payout_claim_retry_authorization_before_insert
      before insert on public.payout_claim_retry_authorizations
      for each row execute function public.validate_payout_claim_retry_authorization();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.payout_claim_retry_authorizations'::regclass
      and tgname='prevent_payout_claim_retry_authorization_rewrite') then
    create trigger prevent_payout_claim_retry_authorization_rewrite
      before update or delete on public.payout_claim_retry_authorizations
      for each row execute function public.prevent_payout_claim_retry_authorization_rewrite();
  end if;
end;
$triggers$;
