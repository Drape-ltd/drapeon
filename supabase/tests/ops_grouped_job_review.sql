begin;
do $$
declare
  v_type text := 'OPS_REVIEW_QA_' || replace(gen_random_uuid()::text,'-','');
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_first jsonb; v_retry jsonb; v_before jsonb; v_health jsonb;
  v_issue public.ops_issues%rowtype;
  v_principal public.ops_workforce_principals%rowtype;
  v_key text := gen_random_uuid()::text;
begin
  if public.current_ops_environment()<>'DEVELOPMENT' then raise exception 'Development only'; end if;
  select * into strict v_principal from public.ops_workforce_principals where status='ACTIVE'
    and 'admin'=any(roles) and access_review_due_at>now() order by id limit 1;
  insert into public.job_queue(id,job_type,status,attempt_count,max_attempts)
    values(v_a,v_type,'DEAD',3,3),(v_b,v_type,'DEAD',3,3);
  v_first := public.register_ops_job_failure(v_a,'TIMEOUT');
  select * into v_issue from public.ops_issues where id=(v_first->>'caseId')::uuid;
  perform public.register_ops_job_failure(v_b,'TIMEOUT');
  begin
    perform public.perform_ops_dead_job_review_action(v_issue.id,'Reviewed all jobs; no replay needed.',v_issue.record_version,v_key,
      v_principal.id,v_principal.email,'DEVELOPMENT',gen_random_uuid());
    raise exception 'Stale membership version accepted';
  exception when serialization_failure then null; end;
  select * into v_issue from public.ops_issues where id=v_issue.id;
  begin
    perform public.perform_ops_dead_job_review_action(v_issue.id,'Reviewed all jobs; no replay needed.',v_issue.record_version,v_key,
      v_principal.id,'spoof@example.test','DEVELOPMENT',gen_random_uuid());
    raise exception 'Actor spoof accepted';
  exception when insufficient_privilege then null; end;
  update public.job_queue set status='PROCESSING' where id=v_b;
  begin
    perform public.perform_ops_dead_job_review_action(v_issue.id,'Reviewed all jobs; no replay needed.',v_issue.record_version,v_key,
      v_principal.id,v_principal.email,'DEVELOPMENT',gen_random_uuid());
    raise exception 'Active job silently reviewed';
  exception when object_not_in_prerequisite_state then null; end;
  update public.job_queue set status='DEAD' where id=v_b;
  select jsonb_agg(to_jsonb(j) order by id) into v_before from public.job_queue j where id in (v_a,v_b);
  v_health := public.get_job_queue_health();
  v_first := public.perform_ops_dead_job_review_action(v_issue.id,'Reviewed both synthetic failures; neither should run again.',v_issue.record_version,v_key,
    v_principal.id,v_principal.email,'DEVELOPMENT',gen_random_uuid());
  v_retry := public.perform_ops_dead_job_review_action(v_issue.id,'Reviewed both synthetic failures; neither should run again.',v_issue.record_version,v_key,
    v_principal.id,v_principal.email,'DEVELOPMENT',gen_random_uuid());
  if v_first->>'receiptOutcome'<>'SUCCEEDED' or v_retry->>'receiptId' is distinct from v_first->>'receiptId'
    or v_retry->>'duplicate'<>'true' then raise exception 'Receipt not idempotent'; end if;
  if (select jsonb_array_length(side_effects) from public.ops_action_receipts where id=(v_first->>'receiptId')::uuid)<>2 then
    raise exception 'Receipt omits reviewed membership'; end if;
  if (public.get_job_queue_health()->>'deadCount')::int <> (v_health->>'deadCount')::int-2
    or (public.get_job_queue_health()->>'totalDeadCount')::int <> (v_health->>'totalDeadCount')::int then
    raise exception 'Actionable and retained counts diverge'; end if;
  if (select count(*) from public.ops_job_case_links where case_number=v_issue.case_number
    and canonical_status='RESOLVED' and dead_job_disposition='ACKNOWLEDGED_NO_REPLAY')<>2 then raise exception 'Job links lost review outcome'; end if;
  if v_before is distinct from (select jsonb_agg(to_jsonb(j) order by id) from public.job_queue j where id in (v_a,v_b)) then
    raise exception 'No-replay review changed execution evidence'; end if;
  if (select count(*) from public.ops_action_receipts where issue_id=v_issue.id and action_key='RESOLVE_DEAD_JOB_NO_REPLAY')<>1 then
    raise exception 'Duplicate review receipt'; end if;
end;
$$;
rollback;
