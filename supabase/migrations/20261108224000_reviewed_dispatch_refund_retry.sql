-- A failed or canceled Stripe dispatch refund can only be retried as a new,
-- separately keyed operation after an exact Money Desk approval. The original
-- refund remains immutable provider evidence. No provider call occurs here.
alter table public.order_fulfillment_runs
  add column customer_provider_refund_id text
  check (customer_provider_refund_id is null or customer_provider_refund_id like 're_%');

create table public.dispatch_refund_retry_operations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.order_fulfillment_runs(id) on delete restrict,
  payment_id uuid not null references public.order_payments(id) on delete restrict,
  money_desk_request_id uuid not null unique references public.money_desk_requests(id) on delete restrict,
  prior_refund_id text not null check (prior_refund_id like 're_%'),
  attempt_number integer not null check (attempt_number >= 2),
  idempotency_key text not null unique,
  status text not null default 'QUEUED' check (status in ('QUEUED','PROCESSING','PENDING','SUCCEEDED','FAILED')),
  provider_refund_id text unique,
  provider_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, attempt_number),
  check (provider_refund_id is null or provider_refund_id like 're_%')
);
create unique index dispatch_refund_retry_one_active_idx
  on public.dispatch_refund_retry_operations(run_id)
  where status in ('QUEUED','PROCESSING','PENDING');
create index dispatch_refund_retry_run_history_idx
  on public.dispatch_refund_retry_operations(run_id, attempt_number desc);
alter table public.dispatch_refund_retry_operations enable row level security;
revoke all on public.dispatch_refund_retry_operations from public, anon, authenticated;
grant select, insert, update on public.dispatch_refund_retry_operations to service_role;

create function public.guard_dispatch_refund_retry_operation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'QUEUED' or new.provider_refund_id is not null
      or new.provider_evidence <> '{}'::jsonb then
      raise exception 'DISPATCH_RETRY_MUST_START_QUEUED';
    end if;
    return new;
  end if;
  if new.run_id is distinct from old.run_id
    or new.payment_id is distinct from old.payment_id
    or new.money_desk_request_id is distinct from old.money_desk_request_id
    or new.prior_refund_id is distinct from old.prior_refund_id
    or new.attempt_number is distinct from old.attempt_number
    or new.idempotency_key is distinct from old.idempotency_key
    or (old.provider_refund_id is not null and new.provider_refund_id is distinct from old.provider_refund_id)
    or (old.status = 'SUCCEEDED' and new.status <> 'SUCCEEDED')
    or (old.status = 'FAILED' and new.status not in ('FAILED','SUCCEEDED'))
    or (old.status = 'PENDING' and new.status not in ('PENDING','SUCCEEDED','FAILED'))
    or (old.status = 'PROCESSING' and new.status not in ('PROCESSING','PENDING','SUCCEEDED','FAILED'))
    or (old.status = 'QUEUED' and new.status not in ('QUEUED','PROCESSING','PENDING','SUCCEEDED','FAILED'))
    or (new.status = 'SUCCEEDED' and new.provider_refund_id is null) then
    raise exception 'DISPATCH_RETRY_TRANSITION_UNSAFE';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger dispatch_refund_retry_operation_guard
  before insert or update on public.dispatch_refund_retry_operations
  for each row execute function public.guard_dispatch_refund_retry_operation();
revoke all on function public.guard_dispatch_refund_retry_operation() from public, anon, authenticated;

create function public.queue_reviewed_dispatch_refund_retry(
  p_money_desk_request_id uuid,
  p_actor_email text,
  p_actor_role text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_request public.money_desk_requests%rowtype;
  v_run public.order_fulfillment_runs%rowtype;
  v_payment public.order_payments%rowtype;
  v_issue public.ops_issues%rowtype;
  v_operation public.dispatch_refund_retry_operations%rowtype;
  v_job public.job_queue%rowtype;
  v_prior_refund_id text;
  v_payment_id uuid;
  v_amount integer;
  v_number integer;
  v_independent_count integer;
  v_key text;
begin
  if nullif(btrim(coalesce(p_actor_email,'')), '') is null
    or upper(btrim(coalesce(p_actor_role,''))) not in ('ADMIN','FINANCE') then
    return jsonb_build_object('outcome','NAMED_EXECUTOR_REQUIRED');
  end if;
  select * into v_request from public.money_desk_requests
    where id = p_money_desk_request_id for update;
  if v_request.id is null or v_request.action_type <> 'CUSTOMER_REFUND'
    or v_request.target_type <> 'DISPATCH_REFUND_RETRY'
    or v_request.status <> 'EXECUTING'
    or v_request.approved_at is null
    or v_request.approval_count < v_request.required_approval_count
    or not exists (select 1 from public.money_desk_execution_attempts e
      where e.request_id = v_request.id and e.status = 'PROCESSING') then
    return jsonb_build_object('outcome','REVIEW_NOT_APPROVED_OR_MISMATCHED');
  end if;
  select count(distinct lower(d.approver_email))::integer
    into v_independent_count from public.money_desk_decisions d
    where d.request_id = v_request.id and d.decision = 'APPROVE'
      and lower(d.approver_email) <> lower(v_request.requester_email);
  if v_independent_count < v_request.required_approval_count then
    return jsonb_build_object('outcome','INSUFFICIENT_INDEPENDENT_APPROVALS');
  end if;
  if v_request.target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('outcome','INVALID_RUN_ID');
  end if;
  select * into v_run from public.order_fulfillment_runs
    where id = v_request.target_id::uuid for update;
  v_amount := coalesce(v_run.customer_refund_amount,0) + coalesce(v_run.customer_refund_tax_amount,0);
  if v_run.id is null or v_run.customer_refund_status <> 'FAILED'
    or v_amount <= 0 or v_request.order_id is distinct from v_run.order_id::text
    or v_request.amount is distinct from v_amount
    or v_request.currency::text is distinct from v_run.currency::text then
    return jsonb_build_object('outcome','RUN_SNAPSHOT_MISMATCH');
  end if;
  v_prior_refund_id := nullif(v_request.action_payload->>'priorRefundId','');
  if v_prior_refund_id is null or v_prior_refund_id not like 're_%'
    or coalesce(v_request.action_payload->>'priorRefundStatus','') not in ('failed','canceled')
    or nullif(v_request.action_payload->>'paymentId','') is null then
    return jsonb_build_object('outcome','PROVIDER_FAILURE_EVIDENCE_REQUIRED');
  end if;
  begin
    v_payment_id := (v_request.action_payload->>'paymentId')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('outcome','PAYMENT_ID_INVALID');
  end;
  select * into v_payment from public.order_payments
    where id = v_payment_id for update;
  if v_payment.id is null or v_payment.order_id::text <> v_run.order_id::text
    or v_payment.provider::text <> 'STRIPE' or v_payment.phase::text <> 'INITIAL_ORDER'
    or v_payment.currency::text <> v_run.currency::text
    or v_payment.status::text not in ('SUCCEEDED','PARTIAL_REFUND')
    or v_payment.amount - coalesce(v_payment.refunded_amount,0) < v_amount
    or v_payment.provider_payment_id not like 'pi_%' then
    return jsonb_build_object('outcome','PAYMENT_SNAPSHOT_MISMATCH');
  end if;
  select * into v_issue from public.ops_issues
    where dedupe_key = 'stripe-refund-failed:' || v_prior_refund_id for update;
  if v_issue.id is null or v_issue.status not in ('OPEN','IN_REVIEW','ESCALATED')
    or v_issue.order_id::text is distinct from v_run.order_id::text
    or v_issue.metadata->>'payment_id' is distinct from v_payment.id::text
    or v_issue.metadata->>'refund_resolution_id' is distinct from 'dispatch-refund:'||v_run.id::text
    or (v_issue.metadata->>'refund_amount')::integer is distinct from v_amount then
    return jsonb_build_object('outcome','OPEN_MATCHED_OPS_CASE_REQUIRED');
  end if;
  select * into v_operation from public.dispatch_refund_retry_operations
    where money_desk_request_id = v_request.id;
  if v_operation.id is not null then
    if v_operation.run_id <> v_run.id or v_operation.payment_id <> v_payment.id
      or v_operation.prior_refund_id <> v_prior_refund_id then
      return jsonb_build_object('outcome','RETRY_REQUEST_ALREADY_BOUND');
    end if;
    select * into v_job from public.job_queue
      where job_type = 'PROCESS_DISPATCH_REFUND'
        and dedupe_key = 'dispatch-refund-reviewed:'||v_operation.id::text;
    return jsonb_build_object('outcome','EXISTING','operationId',v_operation.id,
      'jobId',v_job.id,'attemptNumber',v_operation.attempt_number);
  end if;
  if exists (select 1 from public.job_queue j
    where j.job_type = 'PROCESS_DISPATCH_REFUND'
      and j.payload->>'runId' = v_run.id::text
      and j.status in ('PENDING','PROCESSING','RETRYABLE')) then
    return jsonb_build_object('outcome','PRIOR_JOB_STILL_LIVE');
  end if;
  select * into v_operation from public.dispatch_refund_retry_operations
    where run_id = v_run.id order by attempt_number desc limit 1 for update;
  if v_operation.id is not null
    and (v_operation.status <> 'FAILED' or v_operation.provider_refund_id <> v_prior_refund_id) then
    return jsonb_build_object('outcome','PRIOR_RETRY_NOT_TERMINALLY_FAILED');
  end if;
  v_number := coalesce(v_operation.attempt_number,1) + 1;
  v_key := 'dispatch-refund:'||v_run.id::text||':reviewed:'||v_request.id::text;
  insert into public.dispatch_refund_retry_operations(
    run_id,payment_id,money_desk_request_id,prior_refund_id,attempt_number,idempotency_key)
  values(v_run.id,v_payment.id,v_request.id,v_prior_refund_id,v_number,v_key)
  returning * into v_operation;
  insert into public.job_queue(job_type,status,priority,run_at,max_attempts,dedupe_key,payload)
  values('PROCESS_DISPATCH_REFUND','PENDING',10,now(),8,
    'dispatch-refund-reviewed:'||v_operation.id::text,
    jsonb_build_object('runId',v_run.id,'moneyDeskRequestId',v_request.id,
      'dispatchRetryOperationId',v_operation.id))
  returning * into v_job;
  insert into public.ops_audit_logs(issue_id,action_taken,performed_by,performed_role,reason,before_state,after_state)
  values(v_issue.id,'QUEUE_REVIEWED_DISPATCH_REFUND_RETRY',lower(btrim(p_actor_email)),
    upper(btrim(p_actor_role)),v_request.reason,
    jsonb_build_object('priorRefundId',v_prior_refund_id,'runStatus',v_run.customer_refund_status),
    jsonb_build_object('jobId',v_job.id,'operationId',v_operation.id,'attemptNumber',v_number));
  return jsonb_build_object('outcome','QUEUED','operationId',v_operation.id,
    'jobId',v_job.id,'attemptNumber',v_number);
end;
$$;
revoke all on function public.queue_reviewed_dispatch_refund_retry(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.queue_reviewed_dispatch_refund_retry(uuid,text,text)
  to service_role;
