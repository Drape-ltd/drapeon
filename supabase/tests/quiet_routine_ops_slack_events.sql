-- Development-only, run inside BEGIN / ROLLBACK; no notification escapes.
do $$
declare
  v_job uuid:=gen_random_uuid(); v_issue uuid; v_audit uuid; v_action text; v_count integer;
begin
  if public.current_ops_environment()<>'DEVELOPMENT' then raise exception 'Development only'; end if;
  insert into public.job_queue(id,job_type,status) values(v_job,'OPS_SLACK_QUIET_QA','DEAD');
  v_issue:=(public.register_ops_job_failure(v_job,'OTHER')->>'caseId')::uuid;
  foreach v_action in array array['CASE_ADD_NOTE','CASE_ASSIGN_SELF','CASE_ACKNOWLEDGE','ISSUE_ESCALATED','ISSUE_CREATED','RETRY_JOB'] loop
    insert into public.ops_audit_logs(issue_id,action_taken,performed_role,reason)
      values(v_issue,v_action,'SYSTEM','Synthetic notification policy test') returning id into v_audit;
    select count(*) into v_count from public.domain_events where idempotency_key='ops-slack-audit:'||v_audit::text;
    if v_action in ('CASE_ADD_NOTE','CASE_ASSIGN_SELF','CASE_ACKNOWLEDGE') then
      if v_count<>0 then raise exception 'Routine collaboration enqueued Slack: %',v_action; end if;
    elsif v_count<>1 then raise exception 'Actionable alert was suppressed: %',v_action; end if;
    if not exists(select 1 from public.ops_audit_logs where id=v_audit) then
      raise exception 'Audit evidence was lost'; end if;
  end loop;
end;
$$;
