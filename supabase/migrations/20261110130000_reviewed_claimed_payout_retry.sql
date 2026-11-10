-- Reviewed same-destination retry after a definite not-sent Stripe rejection.
-- Apply only after the reviewed tranche destination-correction migration.

create table public.payout_claim_retry_authorizations (
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

create function public.validate_payout_claim_retry_authorization()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
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

revoke all on function public.validate_payout_claim_retry_authorization()
  from public, anon, authenticated;
grant execute on function public.validate_payout_claim_retry_authorization() to service_role;
create trigger validate_payout_claim_retry_authorization_before_insert
before insert on public.payout_claim_retry_authorizations
for each row execute function public.validate_payout_claim_retry_authorization();

create function public.prevent_payout_claim_retry_authorization_rewrite()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception 'Reviewed claimed-payout retry authorization is immutable';
end;
$function$;
revoke all on function public.prevent_payout_claim_retry_authorization_rewrite()
  from public, anon, authenticated;
grant execute on function public.prevent_payout_claim_retry_authorization_rewrite() to service_role;
create trigger prevent_payout_claim_retry_authorization_rewrite
before update or delete on public.payout_claim_retry_authorizations
for each row execute function public.prevent_payout_claim_retry_authorization_rewrite();

alter table public.payout_provider_operations
  add column reviewed_retry_id uuid unique
    references public.payout_claim_retry_authorizations(id) on delete restrict;

alter table public.payout_provider_operations
  drop constraint payout_provider_operations_check;
alter table public.payout_provider_operations
  add constraint payout_provider_operations_check check (
    (operation_number = 1 and reviewed_correction_id is null
      and reviewed_retry_id is null and money_desk_request_id is null)
    or
    (operation_number > 1 and money_desk_request_id is not null
      and ((reviewed_correction_id is not null and reviewed_retry_id is null)
        or (reviewed_correction_id is null and reviewed_retry_id is not null)))
  );

-- Preserve the operation identity trigger for the new reviewed retry ID.
CREATE OR REPLACE FUNCTION public.prevent_payout_provider_operation_identity_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_transition_allowed boolean := false;
  v_source_bind boolean := false;
begin
  v_source_bind := old.provider_source_transaction_id is null
    and new.provider_source_transaction_id ~ '^ch_[A-Za-z0-9_-]+$'
    and old.provider = 'STRIPE'
    and old.status = 'PROVIDER_UNKNOWN'
    and current_setting('app.bind_payout_source_transaction', true) = 'on';

  if row(new.claim_id, new.operation_number, new.provider, new.provider_destination_id,
         new.currency, new.amount, new.provider_idempotency_key, new.reviewed_correction_id,
         new.reviewed_retry_id, new.money_desk_request_id)
    is distinct from
     row(old.claim_id, old.operation_number, old.provider, old.provider_destination_id,
         old.currency, old.amount, old.provider_idempotency_key, old.reviewed_correction_id,
         old.reviewed_retry_id, old.money_desk_request_id)
    or (new.provider_source_transaction_id is distinct from old.provider_source_transaction_id
      and not v_source_bind) then
    raise exception 'Provider operation identity cannot change';
  end if;

  if new.status = old.status then
    v_transition_allowed := true;
  else
    v_transition_allowed := case old.status
      when 'RESERVED' then new.status in ('PROVIDER_UNKNOWN','PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED')
      when 'PROVIDER_UNKNOWN' then new.status in ('PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED','LATE_SUCCEEDED')
      when 'PROVIDER_PENDING' then new.status in ('PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED','LATE_SUCCEEDED')
      when 'TRANSFERRED' then new.status in ('WITHDRAWN','LATE_SUCCEEDED')
      when 'WITHDRAWN' then new.status = 'LATE_SUCCEEDED'
      when 'FAILED_RETURNED' then new.status = 'LATE_SUCCEEDED'
      when 'LATE_SUCCEEDED' then false
      else false
    end;
  end if;
  if not v_transition_allowed then
    raise exception 'Invalid provider payout operation transition: % -> %', old.status, new.status;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

create function public.apply_reviewed_claimed_payout_retry(
  p_money_desk_request_id uuid,
  p_actor_email text,
  p_actor_role text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
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
    from public.payout_claims c join public.payouts p on p.id=c.payout_id
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
    where id=v_claim.payout_id and order_id=v_claim.order_id for update;
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
      or v_tranche.payout_id is distinct from v_payout.id
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
        where d.order_id=v_order.id::uuid and d.status in ('OPEN','UNDER_REVIEW'))
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
      where id=v_tranche.id and status='BLOCKED' and payout_id=v_payout.id;
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

revoke all on function public.apply_reviewed_claimed_payout_retry(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_reviewed_claimed_payout_retry(uuid,text,text)
  to service_role;

-- A pre-provider Edge rejection can be closed only while no provider attempt
-- exists. The request and claim locks serialize with apply and start, so a
-- lost response after provider start remains PROCESSING for reconciliation.
create function public.close_unstarted_reviewed_claimed_retry(p_request_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
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
      where id=v_claim.payout_id for update;
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
      or v_tranche.payout_id is distinct from v_payout.id
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

revoke all on function public.close_unstarted_reviewed_claimed_retry(uuid)
  from public,anon,authenticated;
grant execute on function public.close_unstarted_reviewed_claimed_retry(uuid)
  to service_role;

create function public.load_reviewed_claimed_tranche_retry(
  p_tranche_id uuid,
  p_money_desk_request_id uuid,
  p_provider text,
  p_destination_id text,
  p_source_transaction text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
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
  select * into v_payout from public.payouts where id=v_claim.payout_id;
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
    or v_claim.payout_id is distinct from v_payout.id
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
    or v_payout.order_id is distinct from v_claim.order_id
    or v_payout.amount is distinct from v_claim.amount
    or v_payout.currency is distinct from v_claim.currency
    or v_payout.provider_destination_id is distinct from p_destination_id
    or v_tranche.status<>'RELEASE_REQUESTED'
    or v_tranche.order_id is distinct from v_claim.order_id
    or v_tranche.payout_id is distinct from v_payout.id
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

revoke all on function public.load_reviewed_claimed_tranche_retry(uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.load_reviewed_claimed_tranche_retry(uuid,uuid,text,text,text)
  to service_role;

-- Keep the existing destination-correction rule intact. A same-destination
-- retry instead has to name the exact immutable authorization created by its
-- executing two-person Money Desk request.
CREATE OR REPLACE FUNCTION public.require_matching_payout_correction_operation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_number integer;
  v_retry public.payout_claim_retry_authorizations%rowtype;
begin
  if new.operation_number=1 then return new; end if;
  if new.reviewed_retry_id is not null then
    select * into v_retry from public.payout_claim_retry_authorizations
      where id=new.reviewed_retry_id;
    if v_retry.id is null
      or v_retry.claim_id is distinct from new.claim_id
      or v_retry.operation_number is distinct from new.operation_number
      or v_retry.money_desk_request_id is distinct from new.money_desk_request_id
      or row(v_retry.provider,v_retry.provider_destination_id,v_retry.currency,
          v_retry.amount,v_retry.provider_source_transaction_id)
        is distinct from row(new.provider,new.provider_destination_id,new.currency,
          new.amount,new.provider_source_transaction_id) then
      raise exception 'Reviewed retry is for a different provider operation';
    end if;
    return new;
  end if;
  select operation_number into v_number
    from public.payout_destination_corrections
    where id=new.reviewed_correction_id;
  if v_number is distinct from new.operation_number then
    raise exception 'Reviewed correction is for a different provider operation';
  end if;
  return new;
end $function$;

-- Fingerprints are meaningful for a changed destination. For a reviewed
-- same-destination retry, bind to the prior operation and accepted claim
-- instead; there is deliberately no correction row to consult.
CREATE OR REPLACE FUNCTION public.verify_provider_operation_destination_fingerprints()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_correction public.payout_destination_corrections%rowtype;
  v_retry public.payout_claim_retry_authorizations%rowtype;
  v_previous public.payout_provider_operations%rowtype;
  v_previous_fingerprint text;
  v_replacement_fingerprint text;
begin
  if new.operation_number=1 then return new; end if;
  select * into v_claim from public.payout_claims where id=new.claim_id;
  select * into v_previous from public.payout_provider_operations
    where claim_id=new.claim_id and operation_number=new.operation_number-1;
  if new.reviewed_retry_id is not null then
    select * into v_retry from public.payout_claim_retry_authorizations
      where id=new.reviewed_retry_id;
    if v_claim.id is null or v_previous.id is null or v_retry.id is null
      or v_retry.claim_id is distinct from v_claim.id
      or v_retry.prior_operation_id is distinct from v_previous.id
      or new.provider_destination_id is distinct from v_previous.provider_destination_id
      or new.provider_destination_id is distinct from v_claim.provider_destination_id
      or new.provider_destination_id is distinct from v_retry.provider_destination_id then
      raise exception 'Reviewed retry destination differs from the accepted claim';
    end if;
    return new;
  end if;
  select * into v_correction from public.payout_destination_corrections
    where id=new.reviewed_correction_id;
  if v_claim.id is null or v_claim.payout_id is null
    or v_correction.id is null or v_previous.id is null then
    raise exception 'Reviewed payout and destination evidence is missing';
  end if;
  if v_correction.failed_payout_id::text is distinct from v_claim.payout_id then
    raise exception 'Reviewed correction belongs to a different payout';
  end if;
  v_previous_fingerprint := encode(digest(new.provider||':'||v_previous.provider_destination_id,'sha256'),'hex');
  v_replacement_fingerprint := encode(digest(new.provider||':'||new.provider_destination_id,'sha256'),'hex');
  if v_correction.previous_destination_fingerprint is distinct from v_previous_fingerprint
    or v_correction.replacement_destination_fingerprint is distinct from v_replacement_fingerprint then
    raise exception 'Provider operation destination differs from the reviewed recovery';
  end if;
  return new;
end $function$;

-- The prior failed operation must be finally closed before either recovery.
-- Same-destination retries require NOT_SENT evidence and the immutable review;
-- the existing different-destination correction branch remains unchanged.
CREATE OR REPLACE FUNCTION public.validate_payout_provider_operation_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_previous public.payout_provider_operations%rowtype;
  v_correction public.payout_destination_corrections%rowtype;
  v_retry public.payout_claim_retry_authorizations%rowtype;
  v_request public.money_desk_requests%rowtype;
  v_approvers integer;
begin
  select * into v_claim from public.payout_claims where id=new.claim_id for update;
  if not found then raise exception 'Payout earning claim is missing'; end if;
  if row(new.provider,new.currency,new.amount)
    is distinct from row(v_claim.provider,v_claim.currency,v_claim.amount) then
    raise exception 'Replacement cannot change payout provider, currency or earning';
  end if;
  if new.operation_number=1 then
    if new.provider_destination_id is distinct from v_claim.provider_destination_id
      or new.provider_idempotency_key is distinct from v_claim.provider_idempotency_key then
      raise exception 'Initial provider operation must match the accepted claim';
    end if;
    return new;
  end if;
  if new.provider_idempotency_key is distinct from
    v_claim.business_key||':op:'||new.operation_number::text then
    raise exception 'Replacement must use its fixed operation key';
  end if;
  select * into v_previous from public.payout_provider_operations
    where claim_id=new.claim_id and operation_number=new.operation_number-1 for update;
  if not found or v_previous.status<>'FAILED_RETURNED'
    or v_previous.final_failure_reference is null
    or v_previous.funds_return_reference is null
    or v_previous.funds_return_confirmed_at is null then
    raise exception 'Previous transfer is not finally returned to available balance';
  end if;
  if new.reviewed_retry_id is not null then
    select * into v_retry from public.payout_claim_retry_authorizations
      where id=new.reviewed_retry_id;
    if v_retry.id is null
      or v_retry.claim_id is distinct from new.claim_id
      or v_retry.prior_operation_id is distinct from v_previous.id
      or v_retry.money_desk_request_id is distinct from new.money_desk_request_id
      or v_retry.operation_number is distinct from new.operation_number
      or v_claim.status <> 'FAILED_RECONCILED'
      or v_claim.transfer_status <> 'FAILED_RECONCILED'
      or v_claim.provider_transfer_id is not null
      or v_previous.provider_transfer_id is not null
      or v_previous.funds_return_reference not like 'NOT_SENT:%'
      or new.provider_destination_id is distinct from v_previous.provider_destination_id
      or new.provider_destination_id is distinct from v_claim.provider_destination_id
      or new.provider_source_transaction_id is distinct from v_retry.provider_source_transaction_id
      or row(new.provider,new.provider_destination_id,new.currency,new.amount)
        is distinct from row(v_retry.provider,v_retry.provider_destination_id,
          v_retry.currency,v_retry.amount) then
      raise exception 'Reviewed same-destination retry is not the definite not-sent operation';
    end if;
    return new;
  end if;
  if new.provider_destination_id is not distinct from v_previous.provider_destination_id then
    raise exception 'Reviewed replacement destination must differ from the failed one';
  end if;
  select * into v_correction from public.payout_destination_corrections
    where id=new.reviewed_correction_id;
  if not found or v_correction.money_desk_request_id is distinct from new.money_desk_request_id
    or v_correction.order_id::text is distinct from v_claim.order_id
    or v_correction.tailor_profile_id::text is distinct from v_claim.tailor_profile_id
    or v_correction.provider::text is distinct from v_claim.provider then
    raise exception 'Reviewed correction does not match this earning claim';
  end if;
  select * into v_request from public.money_desk_requests
    where id=new.money_desk_request_id;
  if not found or v_request.action_type<>'PAYOUT_DESTINATION_CHANGE'
    or v_request.target_type<>'ORDER_PAYOUT_FAILURE'
    or v_request.status<>'SUCCEEDED'
    or v_request.required_approval_count<>2 or v_request.approval_count<>2 then
    raise exception 'Two-person destination correction approval is not terminal';
  end if;
  select count(distinct lower(approver_email)) into v_approvers
    from public.money_desk_decisions
    where request_id=v_request.id and decision='APPROVE'
      and lower(approver_email)<>lower(v_request.requester_email);
  if v_approvers<>2 then
    raise exception 'Two distinct approvers other than the requester are required';
  end if;
  return new;
end $function$;


-- Allow FAILED -> PROCESSING only for the exact same-destination reviewed operation.
CREATE OR REPLACE FUNCTION public.guard_payout_forward_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old text := old.status::text;
  v_new text := new.status::text;
  v_reversal_evidenced boolean := coalesce(current_setting('drape.payout_transfer_reversal', true), '') = 'evidenced';
  v_returned_evidenced boolean := coalesce(current_setting('drape.payout_returned_funds', true), '') = 'evidenced';
  v_reviewed_recovery boolean := false;
begin
  if new.amount is distinct from old.amount or new.currency is distinct from old.currency
     or new.provider is distinct from old.provider then
    raise exception 'PAYOUT_MONEY_IDENTITY_IMMUTABLE';
  end if;
  if old.provider_payout_id is not null and new.provider_payout_id is distinct from old.provider_payout_id then
    raise exception 'PAYOUT_PROVIDER_TRANSFER_ID_IMMUTABLE';
  end if;
  if old.provider_destination_id is not null and new.provider_destination_id is distinct from old.provider_destination_id then
    select exists (
      select 1 from public.payout_destination_corrections correction
      join public.payout_destinations destination on destination.id=correction.replacement_destination_id
      join public.payout_provider_operations operation
        on operation.reviewed_correction_id = correction.id and operation.claim_id=correction.claim_id
      where correction.failed_payout_id::text=old.id::text
        and destination.provider_account_ref=new.provider_destination_id
        and operation.provider_destination_id=new.provider_destination_id
        and operation.operation_number > 1 and operation.status = 'RESERVED'
    ) into v_reviewed_recovery;
    if not v_reviewed_recovery then raise exception 'PAYOUT_DESTINATION_IMMUTABLE'; end if;
  end if;
  new.provider_response := coalesce(old.provider_response,'{}'::jsonb)||coalesce(new.provider_response,'{}'::jsonb);
  if v_old='PAID' and new.completed_at is null and not v_returned_evidenced then
    raise exception 'PAID_PAYOUT_COMPLETION_IMMUTABLE';
  end if;
  if v_old=v_new then return new; end if;
  if v_old='PENDING' and v_new in ('PROCESSING','PAID','FAILED','CANCELED','BLOCKED') then return new; end if;
  if v_old='PROCESSING' and v_new in ('PAID','FAILED','BLOCKED') then return new; end if;
  if v_old in ('PROCESSING','PAID') and v_new='FAILED' and v_returned_evidenced then return new; end if;
  if v_old in ('PROCESSING','PAID') and v_new='REVERSED' and v_reversal_evidenced then return new; end if;
  if v_old in ('FAILED','BLOCKED') and v_new='PROCESSING' then
    if not v_reviewed_recovery then
      select exists (
        select 1 from public.payout_destination_corrections correction
        join public.payout_provider_operations operation
          on operation.reviewed_correction_id = correction.id and operation.claim_id=correction.claim_id
        where correction.failed_payout_id::text=old.id::text
          and operation.operation_number > 1 and operation.status = 'RESERVED'
      ) into v_reviewed_recovery;
    end if;
    if not v_reviewed_recovery then
      select exists (
        select 1 from public.payout_claim_retry_authorizations retry
        join public.payout_claims claim on claim.id=retry.claim_id
        join public.payout_provider_operations operation
          on operation.reviewed_retry_id=retry.id and operation.claim_id=claim.id
        where claim.payout_id=old.id::text
          and retry.money_desk_request_id::text=new.provider_response->>'money_desk_request_id'
          and retry.id::text=new.provider_response->>'reviewed_retry_id'
          and operation.operation_number=retry.operation_number
          and operation.status='RESERVED'
          and claim.status='RESERVED'
          and operation.provider_destination_id=old.provider_destination_id
          and retry.provider_destination_id=old.provider_destination_id
          and operation.amount=old.amount
          and operation.currency=old.currency
      ) into v_reviewed_recovery;
    end if;
    if v_reviewed_recovery then return new; end if;
  end if;
  if v_old='BLOCKED' and v_new in ('FAILED','CANCELED') then return new; end if;
  raise exception 'ILLEGAL_PAYOUT_STATUS_TRANSITION:%->%',v_old,v_new;
end;
$function$;

-- start_payout_attempt: preserve the live body and accept exactly one reviewed recovery.
CREATE OR REPLACE FUNCTION public.start_payout_attempt(p_claim_id uuid, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_attempt public.payout_attempts%rowtype;
  v_number integer;
  v_initial_status text;
begin
  if p_mode not in ('PROVIDER_CALL','RECONCILE') then
    raise exception 'Unknown payout attempt mode';
  end if;
  select * into v_claim from public.payout_claims where id=p_claim_id for update;
  if v_claim.id is null then raise exception 'Payout claim not found'; end if;

  select * into v_operation
    from public.payout_provider_operations
    where claim_id=p_claim_id
    order by operation_number desc
    limit 1 for update;

  -- Claims created before operation tracking keep their exact original key and
  -- transfer reference. A legacy terminal failure is not reconstructed because
  -- it lacks the provider-confirmed funds-return evidence needed for correction.
  if v_operation.id is null and v_claim.status in ('TRANSFERRED','WITHDRAWN')
    and nullif(btrim(v_claim.provider_transfer_id),'') is null then
    raise exception 'Completed payout claim has no provider transfer reference; route it to Ops';
  end if;
  if v_operation.id is null and v_claim.status <> 'FAILED_RECONCILED'
      and v_claim.status <> 'BLOCKED' then
    v_initial_status := case v_claim.status
      when 'PROVIDER_UNKNOWN' then 'PROVIDER_UNKNOWN'
      when 'PROVIDER_PENDING' then 'PROVIDER_PENDING'
      when 'TRANSFERRED' then 'TRANSFERRED'
      when 'WITHDRAWN' then 'WITHDRAWN'
      else 'RESERVED'
    end;
    insert into public.payout_provider_operations (
      claim_id, operation_number, provider, provider_destination_id,
      currency, amount, provider_idempotency_key, status, provider_transfer_id
    ) values (
      v_claim.id, 1, v_claim.provider, v_claim.provider_destination_id,
      v_claim.currency, v_claim.amount, v_claim.provider_idempotency_key,
      v_initial_status, v_claim.provider_transfer_id
    ) returning * into v_operation;
  end if;

  if v_operation.id is not null and (
    v_operation.provider is distinct from v_claim.provider
    or v_operation.currency is distinct from v_claim.currency
    or v_operation.amount is distinct from v_claim.amount
    or (v_operation.operation_number=1 and (
      v_operation.provider_destination_id is distinct from v_claim.provider_destination_id
      or v_operation.provider_idempotency_key is distinct from v_claim.provider_idempotency_key
      or v_operation.reviewed_correction_id is not null
      or v_operation.reviewed_retry_id is not null
      or v_operation.money_desk_request_id is not null
    ))
    or (v_operation.operation_number>1 and (
      v_operation.provider_idempotency_key is distinct from
        v_claim.business_key||':op:'||v_operation.operation_number::text
      or (v_operation.reviewed_correction_id is null
        and v_operation.reviewed_retry_id is null)
      or (v_operation.reviewed_correction_id is not null
        and v_operation.reviewed_retry_id is not null)
      or v_operation.money_desk_request_id is null
    ))
  ) then
    raise exception 'Payout provider operation conflicts with the immutable claim or reviewed correction';
  end if;

  if v_claim.status='BLOCKED' or v_operation.id is null then
    return jsonb_build_object('action','BLOCKED','claim_id',v_claim.id);
  end if;

  if v_claim.status in ('TRANSFERRED','WITHDRAWN') then
    if v_operation.status not in ('TRANSFERRED','WITHDRAWN')
      or nullif(btrim(v_operation.provider_transfer_id),'') is null then
      raise exception 'Confirmed payout claim has no matching successful provider operation';
    end if;
    return jsonb_build_object(
      'action','DONE','claim_id',v_claim.id,
      'claim_operation_id',v_operation.id,
      'operation_number',v_operation.operation_number,
      'provider_idempotency_key',v_operation.provider_idempotency_key,
      'provider_transfer_id',v_operation.provider_transfer_id,
      'provider',v_operation.provider,
      'provider_destination_id',v_operation.provider_destination_id,
      'currency',v_operation.currency,
      'amount',v_operation.amount,
      'reviewed_correction_id',v_operation.reviewed_correction_id,
      'reviewed_retry_id',v_operation.reviewed_retry_id,
      'money_desk_request_id',v_operation.money_desk_request_id
    );
  end if;

  if v_claim.status='FAILED_RECONCILED' then
    return jsonb_build_object('action','BLOCKED','claim_id',v_claim.id);
  end if;

  if (v_claim.status='RESERVED' and p_mode<>'PROVIDER_CALL')
    or (v_claim.status in ('PROVIDER_UNKNOWN','PROVIDER_PENDING') and p_mode<>'RECONCILE') then
    return jsonb_build_object('action','RECONCILE_FIRST','claim_id',v_claim.id,
      'status',v_claim.status);
  end if;

  if v_operation.status in ('TRANSFERRED','WITHDRAWN') then
    return jsonb_build_object(
      'action','DONE','claim_id',v_claim.id,
      'claim_operation_id',v_operation.id,
      'operation_number',v_operation.operation_number,
      'provider_idempotency_key',v_operation.provider_idempotency_key,
      'provider_transfer_id',v_operation.provider_transfer_id,
      'provider',v_operation.provider,
      'provider_destination_id',v_operation.provider_destination_id,
      'currency',v_operation.currency,
      'amount',v_operation.amount,
      'reviewed_correction_id',v_operation.reviewed_correction_id,
      'reviewed_retry_id',v_operation.reviewed_retry_id,
      'money_desk_request_id',v_operation.money_desk_request_id
    );
  end if;
  if v_operation.status='FAILED_RETURNED' or v_operation.status='LATE_SUCCEEDED' then
    return jsonb_build_object('action','BLOCKED','claim_id',v_claim.id);
  end if;
  if p_mode='PROVIDER_CALL' and v_operation.status<>'RESERVED' then
    return jsonb_build_object('action','RECONCILE_FIRST','claim_id',v_claim.id,
      'status',v_operation.status);
  end if;
  if p_mode='RECONCILE' and v_operation.status not in ('PROVIDER_UNKNOWN','PROVIDER_PENDING') then
    return jsonb_build_object('action','RECONCILE_FIRST','claim_id',v_claim.id,
      'status',v_operation.status);
  end if;

  select coalesce(max(attempt_number),0)+1 into v_number
    from public.payout_attempts where claim_id=p_claim_id;
  insert into public.payout_attempts(
    claim_id,attempt_number,claim_operation_id,status,provider_evidence
  ) values (
    p_claim_id,v_number,v_operation.id,'PREPARED',
    jsonb_build_object('mode',p_mode,'operation_number',v_operation.operation_number)
  ) returning * into v_attempt;

  if p_mode='PROVIDER_CALL' then
    update public.payout_provider_operations
      set status='PROVIDER_UNKNOWN'
      where id=v_operation.id and status='RESERVED';
    update public.payout_claims set status='PROVIDER_UNKNOWN',transfer_status='UNKNOWN'
      where id=p_claim_id;
  end if;

  return jsonb_build_object(
    'action',p_mode,'claim_id',v_claim.id,'attempt_id',v_attempt.id,
    'claim_operation_id',v_operation.id,'operation_number',v_operation.operation_number,
    'provider_idempotency_key',v_operation.provider_idempotency_key,
    'provider_transfer_id',v_operation.provider_transfer_id,
    'provider',v_operation.provider,
    'provider_destination_id',v_operation.provider_destination_id,
    'currency',v_operation.currency,'amount',v_operation.amount,
    'reviewed_correction_id',v_operation.reviewed_correction_id,
      'reviewed_retry_id',v_operation.reviewed_retry_id,
    'money_desk_request_id',v_operation.money_desk_request_id
  );
end;
$function$;

-- verify_replacement_attempt_identity: preserve the live body and accept exactly one reviewed recovery.
CREATE OR REPLACE FUNCTION public.verify_replacement_attempt_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_linking boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.claim_operation_id is distinct from old.claim_operation_id then
      if old.claim_operation_id is not null or new.claim_operation_id is null then
        raise exception 'Payout attempt operation link cannot be changed or removed';
      end if;
      v_linking := true;
    end if;
  end if;

  if new.claim_operation_id is null then
    return new;
  end if;

  select * into v_claim from public.payout_claims where id = new.claim_id;
  select * into v_operation from public.payout_provider_operations
    where id = new.claim_operation_id;
  if v_claim.id is null or v_operation.id is null
    or v_operation.claim_id is distinct from new.claim_id
    or v_operation.operation_number not between 1 and 3
    or v_operation.provider is distinct from v_claim.provider
    or v_operation.currency is distinct from v_claim.currency
    or v_operation.amount is distinct from v_claim.amount
    or (v_operation.operation_number = 1 and (
      v_operation.provider_destination_id is distinct from v_claim.provider_destination_id
      or v_operation.provider_idempotency_key is distinct from v_claim.provider_idempotency_key
      or v_operation.reviewed_correction_id is not null
      or v_operation.reviewed_retry_id is not null
      or v_operation.money_desk_request_id is not null
    ))
    or (v_operation.operation_number > 1 and (
      v_operation.provider_idempotency_key is distinct from
        v_claim.business_key || ':op:' || v_operation.operation_number::text
      or (v_operation.reviewed_correction_id is null
        and v_operation.reviewed_retry_id is null)
      or (v_operation.reviewed_correction_id is not null
        and v_operation.reviewed_retry_id is not null)
      or v_operation.money_desk_request_id is null
    )) then
    raise exception 'Payout attempt does not match its immutable provider operation';
  end if;

  if v_linking then
    if new.status = 'SUCCEEDED' then
      if nullif(btrim(new.provider_operation_id), '') is null
        or new.provider_operation_id is distinct from v_operation.provider_transfer_id
        or v_operation.status not in ('TRANSFERRED','WITHDRAWN','LATE_SUCCEEDED') then
        raise exception 'Historical successful attempt needs the exact confirmed provider transfer';
      end if;
    elsif new.provider_evidence->>'operation_number' is distinct from v_operation.operation_number::text
      or v_operation.status not in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING','FAILED_RETURNED') then
      raise exception 'Historical uncertain attempt needs its exact active provider operation';
    end if;
  end if;

  return new;
end;
$function$;

-- The trusted start RPC inserts its attempt before changing RESERVED to
-- PROVIDER_UNKNOWN. Preserve the trigger for other starts, but do not create a
-- second attempt for the operation the RPC has already prepared.
CREATE OR REPLACE FUNCTION public.prepare_replacement_attempt_on_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_attempt_number integer;
begin
  if new.operation_number not between 2 and 3 or old.status<>'RESERVED'
    or new.status<>'PROVIDER_UNKNOWN' then return new; end if;
  if exists (select 1 from public.payout_attempts
    where claim_id=new.claim_id and claim_operation_id=new.id
      and status='PREPARED') then
    return new;
  end if;
  -- The trusted start RPC already holds the claim row. Another attempt under
  -- that claim cannot take this number concurrently; the existing unique
  -- (claim_id,attempt_number) is the final database backstop.
  select coalesce(max(attempt_number),0)+1 into v_attempt_number
    from public.payout_attempts where claim_id=new.claim_id;
  insert into public.payout_attempts (
    claim_id,claim_operation_id,attempt_number,status,provider_evidence
  ) values (
    new.claim_id,new.id,v_attempt_number,'PREPARED',
    jsonb_build_object('stage','REVIEWED_REPLACEMENT_PREPARED',
      'operation_id',new.id,'operation_number',new.operation_number,
      'provider_key',new.provider_idempotency_key)
  );
  return new;
end $function$;
