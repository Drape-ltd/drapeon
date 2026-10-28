-- Forward-only recovery receipts and guards; no existing job is replayed.
-- Recovery attempts retain the original dead-letter evidence. No original job
-- is reset, and completing a worker never automatically closes its Ops case.
create table if not exists public.ops_job_recoveries (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.ops_issues(id),
  receipt_id uuid not null unique references public.ops_action_receipts(id),
  original_job_id uuid not null references public.job_queue(id),
  recovery_job_id uuid not null unique references public.job_queue(id),
  environment text not null check (environment in ('DEVELOPMENT','PRODUCTION')),
  outcome text not null default 'PENDING' check (outcome in ('PENDING','RECOVERED','FAILED','REVIEW_REQUIRED')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  check (original_job_id <> recovery_job_id),
  check ((outcome='PENDING') = (completed_at is null))
);
create unique index if not exists ops_job_recoveries_one_pending_idx on public.ops_job_recoveries(original_job_id)
  where outcome='PENDING';
create index if not exists ops_job_recoveries_original_idx on public.ops_job_recoveries(original_job_id,requested_at desc);
create index if not exists ops_job_recoveries_issue_idx on public.ops_job_recoveries(issue_id,requested_at desc);
alter table public.ops_job_recoveries enable row level security;
revoke all on public.ops_job_recoveries from public,anon,authenticated;
grant select,insert,update on public.ops_job_recoveries to service_role;

-- The worker supplies its own result in the completion transaction. This
-- avoids attributing a different concurrent reconciliation of the same webhook
-- to this recovery. The public Data API roles cannot invoke this function.
create or replace function public.complete_ops_job_recovery(
  p_recovery_job_id uuid, p_outcome text, p_result jsonb
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp set statement_timeout='5s'
as $$
declare
  v_recovery public.ops_job_recoveries%rowtype;
  v_job public.job_queue%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
  v_result jsonb := coalesce(p_result,'{}'::jsonb);
  v_outcome text := p_outcome;
  v_human text;
begin
  -- Completion does not lock/update the case: keep lock ordering independent
  -- of case actions, and leave resolution as an explicit operator decision.
  select * into v_recovery from public.ops_job_recoveries where recovery_job_id=p_recovery_job_id for update;
  if v_recovery.id is null then return jsonb_build_object('notRecovery',true); end if;
  if v_recovery.environment is distinct from public.current_ops_environment() then
    raise exception 'Recovery environment mismatch' using errcode='42501';
  end if;
  if v_recovery.outcome<>'PENDING' then
    return jsonb_build_object('duplicate',true,'outcome',v_recovery.outcome,'receiptId',v_recovery.receipt_id);
  end if;
  select * into strict v_job from public.job_queue where id=p_recovery_job_id;
  if v_job.status not in ('SUCCEEDED','FAILED','DEAD') then
    raise exception 'Recovery job has not finished' using errcode='55000';
  end if;
  if v_outcome is null or v_outcome not in ('RECOVERED','FAILED','REVIEW_REQUIRED') then
    raise exception 'Explicit terminal recovery outcome required' using errcode='22023';
  end if;
  if v_job.status in ('FAILED','DEAD') then v_outcome := 'FAILED'; end if;
  -- Defense in depth: even a caller requesting RECOVERED must provide a
  -- concrete matching result from one of the read-only reconciliation jobs.
  if v_outcome='RECOVERED' and (
    v_result->'matched' is distinct from 'true'::jsonb or
    (
      (v_job.job_type='RECONCILE_PAYMENT_WEBHOOK' and coalesce(v_result->>'mode','') in
        ('STRIPE_EVENT_RETRIEVE','PAYSTACK_TRANSACTION_VERIFY','PAYSTACK_TRANSFER_VERIFY','PAYSTACK_REFUND_RETRIEVE'))
      or (v_job.job_type='RECONCILE_DELIVERY_WEBHOOK' and v_result->>'reason'='DISPATCH_EVENT_MATCHED'
        and length(coalesce(v_result->>'orderId',''))>0 and length(coalesce(v_result->>'fulfillmentEventId',''))>0)
    ) is not true
  ) then v_outcome := 'REVIEW_REQUIRED'; end if;
  v_human := case v_outcome
    when 'RECOVERED' then 'Reconciliation matched. Review the case before resolving it.'
    when 'FAILED' then 'Recovery did not succeed. Inspect the latest evidence before another attempt.'
    else 'Recovery finished without sufficient proof. Manual review is required.' end;
  update public.ops_job_recoveries set outcome=v_outcome,completed_at=now() where id=v_recovery.id;
  update public.ops_action_receipts set
    outcome=case when v_outcome='RECOVERED' then 'SUCCEEDED' else 'FAILED' end,
    human_status=v_human,completed_at=now(),updated_at=now(),
    failure_code=case when v_outcome='RECOVERED' then null else 'RECOVERY_'||v_outcome end,
    blockers=case when v_outcome='RECOVERED' then '[]'::jsonb else jsonb_build_array(v_human) end,
    next_action='Review the linked job and case. The original failed job has not been replayed or removed.',
    side_effects=jsonb_build_array(jsonb_build_object('originalJobId',v_recovery.original_job_id,
      'recoveryJobId',v_recovery.recovery_job_id,'recoveryOutcome',v_outcome))
    where id=v_recovery.receipt_id and outcome='PENDING' returning * into v_receipt;
  if v_receipt.id is null then raise exception 'Recovery receipt is not pending' using errcode='55000'; end if;
  return jsonb_build_object('duplicate',false,'outcome',v_outcome,'receiptId',v_recovery.receipt_id);
end;
$$;
revoke all on function public.complete_ops_job_recovery(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_ops_job_recovery(uuid,text,jsonb) to service_role;

create or replace function public.prevent_ops_case_close_during_recovery() returns trigger
language plpgsql security invoker set search_path=public,pg_temp set statement_timeout='5s'
as $$
begin
  if new.canonical_status in ('RESOLVED','CLOSED','CANCELLED')
    and old.canonical_status is distinct from new.canonical_status
    and exists(select 1 from public.ops_job_recoveries where issue_id=new.id and outcome='PENDING') then
    raise exception 'Wait for the pending recovery before closing this case' using errcode='55000';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_ops_case_close_during_recovery() from public,anon,authenticated;
grant execute on function public.prevent_ops_case_close_during_recovery() to service_role;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'ops_case_recovery_close_guard'
    and tgrelid = 'public.ops_issues'::regclass) then
    create trigger ops_case_recovery_close_guard before update of canonical_status on public.ops_issues
      for each row execute function public.prevent_ops_case_close_during_recovery();
  end if;
end;
$$;

create or replace function public.request_ops_job_recovery(
  p_issue_id uuid, p_job_id uuid, p_reason text, p_expected_record_version bigint,
  p_idempotency_key text, p_actor_principal_id uuid, p_actor_label text,
  p_environment text, p_correlation_id uuid
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp set statement_timeout='5s'
as $$
declare
  v_actor public.ops_workforce_principals%rowtype;
  v_issue public.ops_issues%rowtype;
  v_job public.job_queue%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
  v_recovery public.ops_job_recoveries%rowtype;
  v_child uuid:=gen_random_uuid(); v_webhook uuid; v_provider text; v_event text;
  v_payload jsonb; v_env text:=upper(trim(coalesce(p_environment,'')));
  v_reason text:=trim(coalesce(p_reason,''));
begin
  if p_issue_id is null or p_job_id is null or p_actor_principal_id is null or p_correlation_id is null
    or p_expected_record_version is null or p_expected_record_version<1
    or length(v_reason) not between 12 and 1000
    or length(trim(coalesce(p_idempotency_key,''))) not between 16 and 180 then
    raise exception 'Case, job, version, reason, actor and idempotency key are required' using errcode='22023';
  end if;
  select * into v_actor from public.ops_workforce_principals where id=p_actor_principal_id for share;
  if v_actor.id is null or v_actor.status<>'ACTIVE' or not ('admin'=any(v_actor.roles))
    or lower(trim(coalesce(p_actor_label,''))) is distinct from lower(v_actor.email)
    or not (lower(v_env)=any(v_actor.permitted_environments))
    or v_env not in ('DEVELOPMENT','PRODUCTION') or v_env is distinct from public.current_ops_environment()
    or v_actor.access_review_due_at is null or v_actor.access_review_due_at<=now() then
    raise exception 'Current named administrator required' using errcode='42501';
  end if;
  select * into v_issue from public.ops_issues where id=p_issue_id for update;
  if v_issue.id is null or v_issue.environment<>v_env or v_issue.provenance='UNKNOWN'
    or v_issue.queue_key<>'reliability' or v_issue.related_entity_type not in ('job_queue','job_failure_group') then
    raise exception 'Recovery requires a Reliability job case' using errcode='42501';
  end if;
  if not exists(select 1 from public.ops_queue_policies where environment=v_env and queue_key='reliability'
    and active and retired_at is null and effective_at<=now()
    and permitted_roles && v_actor.roles and 'resolve'=any(permitted_actions)) then
    raise exception 'Reliability action is not permitted' using errcode='42501';
  end if;
  select * into v_receipt from public.ops_action_receipts where issue_id=p_issue_id and idempotency_key=trim(p_idempotency_key);
  if v_receipt.id is not null then
    select * into v_recovery from public.ops_job_recoveries where receipt_id=v_receipt.id;
    if v_receipt.actor_principal_id is distinct from p_actor_principal_id or v_receipt.action_key<>'RETRY_JOB'
      or v_recovery.original_job_id is distinct from p_job_id then
      raise exception 'Idempotency key belongs to another request' using errcode='42501';
    end if;
    return jsonb_build_object('duplicate',true,'receiptId',v_receipt.id,'receiptOutcome',v_receipt.outcome,
      'recoveryJobId',v_recovery.recovery_job_id,'recordVersion',v_issue.record_version,'correlationId',v_receipt.correlation_id);
  end if;
  if v_issue.record_version<>p_expected_record_version then
    raise exception 'CASE_VERSION_CONFLICT:%',v_issue.record_version using errcode='40001'; end if;
  if v_issue.canonical_status in ('RESOLVED','CLOSED','CANCELLED') then
    raise exception 'Terminal cases cannot start recovery' using errcode='55000'; end if;
  if not ((v_issue.related_entity_type='job_queue' and v_issue.related_entity_id=p_job_id::text)
    or exists(select 1 from public.ops_job_case_members where issue_id=p_issue_id and job_id=p_job_id and environment=v_env)) then
    raise exception 'Job is not linked to this case' using errcode='42501'; end if;
  select * into v_job from public.job_queue where id=p_job_id for update;
  if v_job.id is null or v_job.status<>'DEAD'
    or v_job.job_type not in ('RECONCILE_PAYMENT_WEBHOOK','RECONCILE_DELIVERY_WEBHOOK') then
    raise exception 'Only failed read-only webhook reconciliation can be retried here' using errcode='55000'; end if;
  if exists(select 1 from public.ops_job_recoveries where original_job_id=p_job_id and outcome in ('PENDING','RECOVERED'))
    or (select count(*) from public.ops_job_recoveries where original_job_id=p_job_id)>=3 then
    raise exception 'Recovery is pending, already succeeded, or reached its three-request limit' using errcode='55000'; end if;
  begin v_webhook:=(v_job.payload->>'webhookEventId')::uuid;
  exception when invalid_text_representation then
    raise exception 'Job has no valid webhook reference' using errcode='22023'; end;
  if v_job.job_type='RECONCILE_PAYMENT_WEBHOOK' then
    select provider::text,event_type into v_provider,v_event from public.payment_webhook_events
      where id=v_webhook and signature_valid and processed_at is not null for share;
    if v_provider is null or v_provider is distinct from v_job.payload->>'provider'
      or (v_provider='PAYSTACK' and v_event not in ('charge.success','transfer.success','transfer.failed','transfer.reversed',
        'refund.processed','refund.failed','refund.pending','refund.processing')) then
      raise exception 'Verified, processed, independently reconcilable payment event required' using errcode='55000'; end if;
    v_payload:=jsonb_build_object('webhookEventId',v_webhook,'provider',v_provider);
  else
    select provider into v_provider from public.delivery_webhook_events
      where id=v_webhook and signature_valid and processed_at is not null for share;
    if v_provider is null then raise exception 'Verified processed delivery event required' using errcode='55000'; end if;
    v_payload:=jsonb_build_object('webhookEventId',v_webhook);
  end if;
  insert into public.ops_action_receipts(issue_id,action_key,idempotency_key,actor_principal_id,
    expected_record_version,outcome,human_status,correlation_id,next_action,side_effects)
    values(p_issue_id,'RETRY_JOB',trim(p_idempotency_key),p_actor_principal_id,p_expected_record_version,
      'PENDING','Read-only reconciliation queued. No payment or notification is being replayed.',p_correlation_id,
      'Wait for the recovery result before resolving this case.',
      jsonb_build_array(jsonb_build_object('originalJobId',p_job_id,'recoveryJobId',v_child))) returning * into v_receipt;
  insert into public.job_queue(id,job_type,max_attempts,dedupe_key,payload)
    values(v_child,v_job.job_type,3,'ops-recovery:'||v_receipt.id::text,v_payload);
  insert into public.ops_job_recoveries(issue_id,receipt_id,original_job_id,recovery_job_id,environment)
    values(p_issue_id,v_receipt.id,p_job_id,v_child,v_env) returning * into v_recovery;
  update public.ops_issues set first_responded_at=coalesce(first_responded_at,now()) where id=p_issue_id
    returning * into v_issue;
  update public.ops_action_receipts set resulting_record_version=v_issue.record_version where id=v_receipt.id;
  insert into public.ops_case_events(issue_id,event_type,visibility,sensitivity,actor_principal_id,actor_label,
    summary,payload,idempotency_key,correlation_id)
    values(p_issue_id,'DECISION','INTERNAL',v_issue.sensitivity,p_actor_principal_id,v_actor.email,
      'A named administrator requested a bounded read-only reconciliation.',
      jsonb_build_object('originalJobId',p_job_id,'recoveryJobId',v_child,'reason',v_reason),
      'job-recovery:'||v_receipt.id::text,p_correlation_id);
  insert into public.ops_audit_logs(issue_id,action_taken,performed_by,performed_role,reason,before_state,after_state)
    values(p_issue_id,'RETRY_JOB',v_actor.email,'admin',v_reason,
      jsonb_build_object('originalJobId',p_job_id,'status',v_job.status),
      jsonb_build_object('recoveryJobId',v_child,'receiptId',v_receipt.id,'outcome','PENDING'));
  return jsonb_build_object('duplicate',false,'receiptId',v_receipt.id,'receiptOutcome','PENDING',
    'recoveryJobId',v_child,'recordVersion',v_issue.record_version,'correlationId',p_correlation_id);
end;
$$;
revoke all on function public.request_ops_job_recovery(uuid,uuid,text,bigint,text,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.request_ops_job_recovery(uuid,uuid,text,bigint,text,uuid,text,text,uuid) to service_role;

create or replace function public.finish_ops_reconciliation_job(
  p_job_id uuid,p_worker_id text,p_succeeded boolean,p_error text,p_duration_ms integer,p_result jsonb
) returns void language plpgsql security invoker
set search_path=public,pg_temp set statement_timeout='5s' as $$
declare v_type text;
begin
  select job_type into v_type from public.job_queue where id=p_job_id;
  if v_type is null or v_type not in ('RECONCILE_PAYMENT_WEBHOOK','RECONCILE_DELIVERY_WEBHOOK') then
    raise exception 'Reconciliation job required' using errcode='22023'; end if;
  -- finish_job checks the live worker lease and writes the attempt. Both this
  -- transition and the receipt settlement commit, or neither does.
  perform public.finish_job(p_job_id,p_worker_id,p_succeeded,p_error,null,p_duration_ms);
  if p_succeeded then
    perform public.complete_ops_job_recovery(p_job_id,
      case when p_result->'matched'='false'::jsonb then 'FAILED' else 'RECOVERED' end,p_result);
  end if;
end;
$$;
revoke all on function public.finish_ops_reconciliation_job(uuid,text,boolean,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.finish_ops_reconciliation_job(uuid,text,boolean,text,integer,jsonb) to service_role;

-- Also settles failures produced by lease recovery/watchdog paths, not only
-- the ordinary worker catch block. Non-recovery jobs are ignored cheaply.
create or replace function public.settle_dead_ops_job_recovery() returns trigger
language plpgsql security invoker set search_path=public,pg_temp set statement_timeout='5s' as $$
begin
  perform public.complete_ops_job_recovery(new.id,'FAILED','{}'::jsonb);
  return new;
end;
$$;
revoke all on function public.settle_dead_ops_job_recovery() from public,anon,authenticated;
grant execute on function public.settle_dead_ops_job_recovery() to service_role;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'settle_dead_ops_job_recovery'
    and tgrelid = 'public.job_queue'::regclass) then
    create trigger settle_dead_ops_job_recovery after update of status on public.job_queue
      for each row when (new.status in ('DEAD','FAILED') and old.status is distinct from new.status)
      execute function public.settle_dead_ops_job_recovery();
  end if;
end;
$$;

create or replace function public.get_ops_job_recovery_context(p_issue_id uuid,p_job_id uuid,p_environment text)
returns jsonb language sql stable security invoker set search_path=public,pg_temp set statement_timeout='5s' as $$
  select jsonb_build_object('jobId',j.id,'jobType',j.job_type,'jobStatus',j.status,
    'attempts',coalesce((select jsonb_agg(jsonb_build_object('jobId',r.recovery_job_id,'outcome',r.outcome,
      'requestedAt',r.requested_at,'completedAt',r.completed_at,'receiptId',r.receipt_id) order by r.requested_at desc)
      from public.ops_job_recoveries r where r.original_job_id=j.id and r.issue_id=i.id and r.environment=i.environment),'[]'::jsonb))
  from public.ops_issues i join public.job_queue j on j.id=p_job_id
  where i.id=p_issue_id and i.environment=p_environment and i.environment=public.current_ops_environment()
    and i.provenance<>'UNKNOWN' and i.queue_key='reliability'
    and ((i.related_entity_type='job_queue' and i.related_entity_id=j.id::text)
      or exists(select 1 from public.ops_job_case_members m where m.issue_id=i.id and m.job_id=j.id and m.environment=i.environment));
$$;
revoke all on function public.get_ops_job_recovery_context(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_ops_job_recovery_context(uuid,uuid,text) to service_role;
