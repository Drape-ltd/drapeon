-- Draft structural foundation for a separately reviewed, same-destination
-- retry after Stripe has definitively confirmed that no transfer was sent.
-- The executable RPC/guard changes must land in this same migration before it
-- is applied anywhere. An operation cannot use this column until those guards
-- are installed, so the existing correction path stays authoritative.

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
  v_existing public.payout_claim_retry_authorizations%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_next_number integer;
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
  select * into v_claim from public.payout_claims
    where id=v_request.target_id::uuid for update;
  if v_claim.id is null then raise exception 'Reviewed payout claim is missing'; end if;
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
