-- Future failed jobs only. Historical cases are not silently merged or closed.
create table public.ops_job_case_members (
  job_id uuid primary key references public.job_queue(id),
  issue_id uuid not null references public.ops_issues(id),
  environment text not null check (environment in ('DEVELOPMENT','PRODUCTION')),
  failure_cause text not null,
  created_at timestamptz not null default now()
);
create index ops_job_case_members_issue_idx on public.ops_job_case_members(issue_id,created_at,job_id);
alter table public.ops_job_case_members enable row level security;
revoke all on public.ops_job_case_members from public,anon,authenticated;
grant select,insert on public.ops_job_case_members to service_role;
create index ops_issues_active_job_failure_group_idx
  on public.ops_issues(environment,(metadata->>'failureGroupKey'),created_at desc,id)
  where related_entity_type='job_failure_group' and canonical_status not in ('RESOLVED','CLOSED','CANCELLED');

create or replace function public.register_ops_job_failure(p_job_id uuid,p_cause text)
returns jsonb language plpgsql security invoker
set search_path=public,pg_temp set statement_timeout='5s'
as $$
declare
  v_env text := public.current_ops_environment();
  v_job public.job_queue%rowtype;
  v_issue public.ops_issues%rowtype;
  v_key text;
  v_provider text;
  v_new boolean := false;
  v_count integer;
begin
  if v_env is null or v_env not in ('DEVELOPMENT','PRODUCTION') then
    raise exception 'Known Ops environment required' using errcode='42501';
  end if;
  if p_cause is null or p_cause not in ('PROVIDER_AUTH','RATE_LIMIT','TIMEOUT','NETWORK','OTHER') then
    raise exception 'Unsupported failure cause' using errcode='22023';
  end if;
  -- Same lock as manual source-case repair: neither path can create a second case.
  perform pg_advisory_xact_lock(hashtextextended('ops-source:job:' || p_job_id::text,0));
  select * into v_job from public.job_queue where id=p_job_id for share;
  if v_job.id is null or v_job.status <> 'DEAD' then
    raise exception 'Only terminal failed jobs can be registered' using errcode='55000';
  end if;
  if v_job.job_type in ('CREATE_OPS_ISSUE','SEND_OPS_SLACK','SEND_OPS_SLACK_DIGEST') then
    raise exception 'Recursive Ops delivery jobs are excluded' using errcode='22023';
  end if;
  select i.* into v_issue from public.ops_job_case_members m join public.ops_issues i on i.id=m.issue_id
    where m.job_id=p_job_id and m.environment=v_env and i.environment=v_env;
  if v_issue.id is not null then
    return jsonb_build_object('caseId',v_issue.id,'caseNumber',v_issue.case_number,'duplicate',true);
  end if;
  -- Preserve existing manual/legacy review, including its terminal outcome.
  select * into v_issue from public.ops_issues where environment=v_env
    and related_entity_type='job_queue' and related_entity_id=p_job_id::text
    order by created_at desc,id limit 1;
  if v_issue.id is not null then
    insert into public.ops_job_case_members(job_id,issue_id,environment,failure_cause) values(p_job_id,v_issue.id,v_env,p_cause);
    return jsonb_build_object('caseId',v_issue.id,'caseNumber',v_issue.case_number,'existing',true);
  end if;
  v_provider := upper(coalesce(nullif(v_job.payload->>'provider',''),'DEFAULT'));
  if v_provider !~ '^[A-Z0-9_-]{1,40}$' then v_provider := 'UNKNOWN'; end if;
  v_key := 'job-failure:v1:' || v_env || ':' || v_job.job_type || ':' || v_provider || ':' || p_cause;
  if p_cause='OTHER' or v_provider='UNKNOWN' then v_key := v_key || ':' || p_job_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key,0));
  select * into v_issue from public.ops_issues
    where environment=v_env and related_entity_type='job_failure_group'
      and metadata->>'failureGroupKey'=v_key and canonical_status not in ('RESOLVED','CLOSED','CANCELLED')
    order by created_at desc,id limit 1 for update;
  if v_issue.id is null then
    insert into public.ops_issues(issue_type,severity,status,source,related_entity_type,queue_key,stage,
      title,description,recommended_action,dedupe_key,environment,provenance,priority,metadata)
    values('SYSTEM_ALERT','HIGH','OPEN','process-job-queue','job_failure_group','reliability',v_job.job_type,
      initcap(replace(lower(v_job.job_type),'_',' ')) || ': ' || case p_cause
        when 'PROVIDER_AUTH' then 'provider credentials rejected' when 'RATE_LIMIT' then 'provider rate limit'
        when 'TIMEOUT' then 'request timed out' when 'NETWORK' then 'connection failed' else 'failure needs investigation' end,
      'Background tasks failed. Review the linked jobs and their individual outcomes before recovery.',
      'Engineering: fix the shared cause, then review each affected job before any replay. Closing this case does not complete the jobs.',
      v_key || ':' || gen_random_uuid(),v_env,case when v_env='PRODUCTION' then 'REAL' else 'QA' end,'P1',
      jsonb_build_object('failureGroupKey',v_key,'failureCause',p_cause,'job_type',v_job.job_type,'affectedJobCount',0))
    returning * into v_issue;
    v_new := true;
  end if;
  insert into public.ops_job_case_members(job_id,issue_id,environment,failure_cause) values(p_job_id,v_issue.id,v_env,p_cause);
  select count(*) into v_count from public.ops_job_case_members where issue_id=v_issue.id;
  -- Do not overwrite canonical status, ownership, first response, or SLA clocks.
  update public.ops_issues set metadata=metadata || jsonb_build_object('affectedJobCount',v_count),last_seen_at=now()
    where id=v_issue.id;
  insert into public.ops_case_events(issue_id,event_type,actor_label,summary,payload,idempotency_key,correlation_id)
    values(v_issue.id,'PROVIDER_OUTCOME','SYSTEM','Failed job added to this investigation',
      jsonb_build_object('jobId',p_job_id,'jobType',v_job.job_type,'failureCause',p_cause,'affectedJobCount',v_count),
      'failed-job:' || p_job_id,gen_random_uuid());
  -- One immediate alert per investigation; later members stay in the case timeline.
  if v_new then
    insert into public.ops_audit_logs(issue_id,action_taken,performed_role,after_state)
      values(v_issue.id,'ISSUE_CREATED','SYSTEM',jsonb_build_object('status','OPEN','failureCause',p_cause,'affectedJobCount',v_count));
  end if;
  return jsonb_build_object('caseId',v_issue.id,'caseNumber',v_issue.case_number,'affectedJobCount',v_count,'created',v_new);
end;
$$;
revoke all on function public.register_ops_job_failure(uuid,text) from public,anon,authenticated;
grant execute on function public.register_ops_job_failure(uuid,text) to service_role;

-- Same shape as legacy per-job links, without exposing payloads or raw errors.
create view public.ops_job_case_links with (security_invoker=true) as
select m.job_id::text as related_entity_id,'job_queue'::text as related_entity_type,
  i.case_number,i.issue_number,i.canonical_status,i.status,i.updated_at,i.environment
from public.ops_job_case_members m join public.ops_issues i on i.id=m.issue_id and i.environment=m.environment
union all
select i.related_entity_id,i.related_entity_type,i.case_number,i.issue_number,i.canonical_status,i.status,i.updated_at,i.environment
from public.ops_issues i where i.related_entity_type='job_queue'
  and not exists(select 1 from public.ops_job_case_members m where m.job_id::text=i.related_entity_id and m.environment=i.environment);
revoke all on public.ops_job_case_links from public,anon,authenticated;
grant select on public.ops_job_case_links to service_role;
create view public.ops_grouped_job_items with (security_invoker=true) as
select j.id,j.job_type,j.status,j.attempt_count,j.max_attempts,j.run_at,j.created_at,j.updated_at,
  i.case_number,i.environment
from public.ops_job_case_members m join public.ops_issues i on i.id=m.issue_id and i.environment=m.environment
join public.job_queue j on j.id=m.job_id;
revoke all on public.ops_grouped_job_items from public,anon,authenticated;
grant select on public.ops_grouped_job_items to service_role;

-- Explicit operator repair for a source record with no controlling Ops case.
-- This creates review ownership only: no order transition, payment, or job replay.
create or replace function public.create_ops_source_case(
  p_source_type text,
  p_source_id text,
  p_reason text,
  p_idempotency_key text,
  p_actor_principal_id uuid,
  p_actor_label text,
  p_environment text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
set statement_timeout = '5s'
as $$
declare
  v_environment text := upper(trim(coalesce(p_environment, '')));
  v_source text := lower(trim(coalesce(p_source_type, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_key text := trim(coalesce(p_idempotency_key, ''));
  v_queue text;
  v_dedupe text;
  v_title text;
  v_principal public.ops_workforce_principals%rowtype;
  v_policy public.ops_queue_policies%rowtype;
  v_order public.orders%rowtype;
  v_job public.job_queue%rowtype;
  v_issue public.ops_issues%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
begin
  if v_source not in ('order', 'job') or p_source_id is null
    or length(p_source_id) not between 1 and 180 or p_source_id <> trim(p_source_id)
    or p_actor_principal_id is null or p_correlation_id is null
    or length(v_reason) not between 12 and 1000
    or length(v_key) not between 16 and 180 then
    raise exception 'Source, bounded reason, actor, correlation and idempotency key are required.' using errcode = '22023';
  end if;
  if v_environment not in ('DEVELOPMENT', 'PRODUCTION')
    or public.current_ops_environment() is distinct from v_environment then
    raise exception 'Ops environment mismatch.' using errcode = '42501';
  end if;
  if v_source = 'job' then p_source_id := lower(p_source_id); end if;
  v_queue := case when v_source = 'job' then 'reliability' else 'operations' end;
  select * into v_principal from public.ops_workforce_principals
    where id = p_actor_principal_id for share;
  if v_principal.id is null or v_principal.status <> 'ACTIVE'
    or lower(trim(coalesce(p_actor_label, ''))) is distinct from lower(v_principal.email)
    or not (lower(v_environment) = any(v_principal.permitted_environments))
    or v_principal.access_review_due_at is null or v_principal.access_review_due_at <= now() then
    raise exception 'Named workforce access is required.' using errcode = '42501';
  end if;
  select * into v_policy from public.ops_queue_policies
    where environment = v_environment and queue_key = v_queue
      and active and retired_at is null and effective_at <= now()
    order by effective_at desc, updated_at desc limit 1;
  if v_policy.id is null or not (v_principal.roles && v_policy.permitted_roles)
    or not ('triage' = any(v_policy.permitted_actions) or 'acknowledge' = any(v_policy.permitted_actions)) then
    raise exception 'This workforce role cannot triage the source queue.' using errcode = '42501';
  end if;

  -- Serialize this source repair without a dashboard-wide/table lock.
  perform pg_advisory_xact_lock(hashtextextended('ops-source:' || v_source || ':' || p_source_id::text, 0));
  select receipt.* into v_receipt from public.ops_action_receipts receipt
    join public.ops_issues issue on issue.id = receipt.issue_id
    where receipt.action_key = 'CREATE_SOURCE_CASE' and receipt.idempotency_key = v_key
      and receipt.actor_principal_id = p_actor_principal_id
      and issue.environment = v_environment
      and issue.metadata->>'repairSourceType' = v_source
      and issue.metadata->>'repairSourceId' = p_source_id::text;
  if v_receipt.id is not null then
    select * into v_issue from public.ops_issues where id = v_receipt.issue_id;
    return jsonb_build_object('duplicate', true, 'caseId', v_issue.id, 'caseNumber', v_issue.case_number,
      'receiptId', v_receipt.id, 'correlationId', v_receipt.correlation_id);
  end if;

  if v_source = 'job' then
    if p_source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Job identifier is invalid.' using errcode = '22023';
    end if;
    select * into v_job from public.job_queue where id = p_source_id::uuid for share;
    if v_job.id is null or v_job.status <> 'DEAD' then
      raise exception 'Only a terminal failed job can enter this review.' using errcode = '55000';
    end if;
    -- These jobs must not generate recursive Ops/Slack cases.
    if v_job.job_type in ('CREATE_OPS_ISSUE', 'SEND_OPS_SLACK', 'SEND_OPS_SLACK_DIGEST') then
      raise exception 'Ops delivery failures require the health incident workflow.' using errcode = '22023';
    end if;
    v_dedupe := 'job-dead:' || p_source_id::text;
    v_title := 'Failed ' || replace(lower(v_job.job_type), '_', ' ') || ' needs review';
    select * into v_issue from public.ops_issues
      where environment = v_environment and provenance <> 'UNKNOWN'
        and (dedupe_key = v_dedupe or (related_entity_type = 'job_queue' and related_entity_id = p_source_id::text)
          or id in (select issue_id from public.ops_job_case_members where job_id=p_source_id::uuid and environment=v_environment))
      order by created_at desc limit 1;
  else
    select * into v_order from public.orders where id = p_source_id::text for share;
    if v_order.id is null or v_order.stage::text <> 'IN_DISPUTE' then
      raise exception 'The order is no longer in dispute.' using errcode = '55000';
    end if;
    -- A new review after a prior case closed is distinct, but a retry of the
    -- original request still returns its original receipt above.
    v_dedupe := 'ops-order-gap:' || p_source_id || ':' || coalesce((
      select id::text from public.ops_issues where order_id=p_source_id
        and environment=v_environment and provenance <> 'UNKNOWN'
        and canonical_status in ('RESOLVED','CLOSED','CANCELLED')
      order by created_at desc, id desc limit 1
    ), 'initial');
    v_title := 'Disputed order needs an operator';
    select * into v_issue from public.ops_issues
      where environment = v_environment and provenance <> 'UNKNOWN' and order_id = p_source_id::text
        and canonical_status not in ('RESOLVED', 'CLOSED', 'CANCELLED')
      order by created_at desc limit 1;
  end if;
  if v_issue.id is not null then
    return jsonb_build_object('existing', true, 'caseId', v_issue.id, 'caseNumber', v_issue.case_number);
  end if;

  insert into public.ops_issues (
    issue_type, severity, status, canonical_status, source, order_id,
    related_entity_type, related_entity_id, title, description, recommended_action,
    dedupe_key, metadata, queue_key, priority, environment, provenance
  ) values (
    case when v_source = 'job' then 'SYSTEM_ALERT' else 'ORDER_REVIEW' end,
    'HIGH', 'OPEN', 'NEW', 'ops-source-case-repair',
    case when v_source = 'order' then p_source_id::text else null end,
    case when v_source = 'job' then 'job_queue' else 'orders' end, p_source_id::text,
    v_title, v_reason,
    case when v_source = 'job' then 'Review the failed job and current workflow before deciding whether recovery is safe.'
      else 'Review the order timeline, evidence and payment state before deciding the dispute outcome.' end,
    v_dedupe, jsonb_build_object('repairSourceType', v_source, 'repairSourceId', p_source_id,
      'job_type', case when v_source = 'job' then v_job.job_type else null end),
    v_queue, 'P1', v_environment, case when v_environment = 'DEVELOPMENT' then 'QA' else 'REAL' end
  ) on conflict (dedupe_key) do nothing returning * into v_issue;
  if v_issue.id is null then
    select * into v_issue from public.ops_issues where dedupe_key = v_dedupe;
    if v_issue.environment is distinct from v_environment or v_issue.provenance = 'UNKNOWN' then
      raise exception 'Conflicting case provenance requires review.' using errcode = '42501';
    end if;
    return jsonb_build_object('existing', true, 'caseId', v_issue.id, 'caseNumber', v_issue.case_number);
  end if;
  insert into public.ops_action_receipts (
    issue_id, action_key, idempotency_key, actor_principal_id, expected_record_version,
    resulting_record_version, outcome, human_status, correlation_id, completed_at
  ) values (
    v_issue.id, 'CREATE_SOURCE_CASE', v_key, p_actor_principal_id, v_issue.record_version,
    v_issue.record_version, 'SUCCEEDED', 'Review case created. Source record unchanged.', p_correlation_id, now()
  ) returning * into v_receipt;
  insert into public.ops_case_events (
    issue_id, event_type, visibility, sensitivity, actor_principal_id, actor_label,
    to_status, summary, payload, idempotency_key, correlation_id
  ) values (
    v_issue.id, 'STATE_TRANSITION', 'INTERNAL', v_issue.sensitivity, p_actor_principal_id, v_principal.email,
    'NEW', 'An operator created review ownership for an existing source record.',
    jsonb_build_object('sourceType', v_source, 'sourceId', p_source_id, 'reason', v_reason),
    'source-case:' || v_receipt.id::text, p_correlation_id
  );
  insert into public.ops_audit_logs (issue_id, action_taken, performed_by, performed_role, reason, after_state)
    values (v_issue.id, 'CREATE_SOURCE_CASE', v_principal.email, array_to_string(v_principal.roles, ','), v_reason,
      jsonb_build_object('sourceType', v_source, 'sourceId', p_source_id, 'receiptId', v_receipt.id));
  return jsonb_build_object('duplicate', false, 'caseId', v_issue.id, 'caseNumber', v_issue.case_number,
    'receiptId', v_receipt.id, 'correlationId', v_receipt.correlation_id);
end;
$$;

revoke all on function public.create_ops_source_case(text,text,text,text,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.create_ops_source_case(text,text,text,text,uuid,text,text,uuid) to service_role;
