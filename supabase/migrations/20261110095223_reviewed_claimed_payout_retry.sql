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
    or v_request.action_payload->>'sourceTransaction' is distinct from v_previous.provider_source_transaction_id then
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
