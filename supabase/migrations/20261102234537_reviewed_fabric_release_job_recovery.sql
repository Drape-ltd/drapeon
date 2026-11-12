create or replace function public.queue_reviewed_fabric_release_recovery(
  p_money_desk_request_id uuid,
  p_actor_email text,
  p_actor_role text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.money_desk_requests%rowtype;
  v_candidate public.order_fabric_candidates%rowtype;
  v_issue public.ops_issues%rowtype;
  v_job public.job_queue%rowtype;
  v_key text;
  v_independent_approval_count integer;
begin
  select * into v_request from public.money_desk_requests
  where id=p_money_desk_request_id for update;
  if v_request.id is null
    or v_request.action_type <> 'POST_RELEASE_RECOVERY'
    or v_request.target_type <> 'FABRIC_RELEASE_JOB'
    or v_request.status <> 'EXECUTING'
    or not exists (select 1 from public.money_desk_execution_attempts e where e.request_id=v_request.id and e.status='PROCESSING')
  then return jsonb_build_object('outcome','REVIEW_NOT_APPROVED_OR_MISMATCHED'); end if;

  if v_request.target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then raise exception 'FABRIC_RECOVERY_TARGET_INVALID'; end if;

  select * into v_candidate from public.order_fabric_candidates
  where id=v_request.target_id::uuid for update;
  if v_candidate.id is null or v_candidate.status not in ('RELEASE_BLOCKED','RELEASE_PROCESSING')
    or v_candidate.provider_status='SUCCEEDED'
  then raise exception 'FABRIC_RECOVERY_CANDIDATE_NOT_BLOCKED'; end if;
  if v_request.approved_at is null
    or v_request.approval_count < v_request.required_approval_count
    or v_request.order_id is distinct from v_candidate.order_id::text
    or v_request.amount is distinct from v_candidate.supplier_cost_amount
    or v_request.currency::text is distinct from v_candidate.currency::text
  then return jsonb_build_object('outcome','REVIEW_NOT_APPROVED_OR_MISMATCHED'); end if;

  select count(distinct lower(d.approver_email))::integer
  into v_independent_approval_count
  from public.money_desk_decisions d
  where d.request_id=v_request.id
    and d.decision='APPROVE'
    and lower(d.approver_email)<>lower(v_request.requester_email);
  if v_independent_approval_count < v_request.required_approval_count
  then return jsonb_build_object('outcome','INSUFFICIENT_INDEPENDENT_APPROVALS'); end if;

  v_key := 'fabric-release:'||v_candidate.id::text||':recovery:'||v_request.id::text;
  select * into v_job from public.job_queue
  where job_type='PROCESS_FABRIC_RELEASE' and dedupe_key=v_key;
  if v_job.id is not null then
    return jsonb_build_object('duplicate',true,'jobId',v_job.id,'opsIssueId',v_job.payload->>'opsIssueId');
  end if;
  if exists (select 1 from public.job_queue j where j.job_type='PROCESS_FABRIC_RELEASE'
    and j.payload->>'candidateId'=v_candidate.id::text and j.status in ('PENDING','PROCESSING','RETRYABLE'))
  then raise exception 'FABRIC_RECOVERY_JOB_STILL_LIVE'; end if;
  if exists (select 1 from public.payouts p where p.fabric_candidate_id=v_candidate.id and p.status='PAID')
  then raise exception 'FABRIC_RECOVERY_ALREADY_PAID'; end if;
  if coalesce((v_candidate.provider_response->>'recordedAt')::timestamptz,v_candidate.updated_at) > now()-interval '15 minutes'
  then raise exception 'FABRIC_RECOVERY_VISIBILITY_WINDOW'; end if;

  select * into v_issue from public.ops_issues
  where dedupe_key='fabric-candidate:release:'||v_candidate.id::text for update;
  if v_issue.id is null or v_issue.status not in ('OPEN','ACKNOWLEDGED','INVESTIGATING')
  then raise exception 'FABRIC_RECOVERY_OPS_CASE_REQUIRED'; end if;

  insert into public.job_queue(job_type,status,priority,run_at,max_attempts,dedupe_key,payload)
  values ('PROCESS_FABRIC_RELEASE','PENDING',10,now(),8,v_key,jsonb_build_object(
    'candidateId',v_candidate.id,'moneyDeskRequestId',v_request.id,'opsIssueId',v_issue.id))
  on conflict (job_type,dedupe_key) where dedupe_key is not null do nothing
  returning * into v_job;
  if v_job.id is null then
    select * into v_job from public.job_queue where job_type='PROCESS_FABRIC_RELEASE' and dedupe_key=v_key;
    return jsonb_build_object('duplicate',true,'jobId',v_job.id,'opsIssueId',v_issue.id);
  end if;

  insert into public.ops_audit_logs(issue_id,action_taken,performed_by,performed_role,reason,before_state,after_state)
  values(v_issue.id,'QUEUE_REVIEWED_FABRIC_RELEASE_RECOVERY',lower(btrim(p_actor_email)),upper(btrim(p_actor_role)),v_request.reason,
    jsonb_build_object('candidateStatus',v_candidate.status,'providerStatus',v_candidate.provider_status),
    jsonb_build_object('jobId',v_job.id,'moneyDeskRequestId',v_request.id,'dedupeKey',v_key));
  return jsonb_build_object('duplicate',false,'jobId',v_job.id,'opsIssueId',v_issue.id);
end;
$$;

revoke all on function public.queue_reviewed_fabric_release_recovery(uuid,text,text) from public,anon,authenticated;
grant execute on function public.queue_reviewed_fabric_release_recovery(uuid,text,text) to service_role;

comment on function public.queue_reviewed_fabric_release_recovery(uuid,text,text) is
  'Queues one candidate-scoped recovery job only through an executing, independently approved Money Desk request.';
