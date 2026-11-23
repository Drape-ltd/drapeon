-- Run with the migration inside a Dev transaction, then ROLLBACK.
do $$
declare
  v_principal uuid;
  v_existing_user uuid;
  v_absent_user uuid := gen_random_uuid();
  v_issue uuid;
  v_second_issue uuid;
  v_version bigint;
  v_second_version bigint;
  v_result jsonb;
begin
  if public.current_ops_environment() <> 'DEVELOPMENT' then
    raise exception 'This proof may run only on Dev.';
  end if;
  select id into v_principal from public.ops_workforce_principals
    where status='ACTIVE' and 'development'=any(permitted_environments)
      and 'admin'=any(roles) order by created_at desc limit 1;
  select id into v_existing_user from public.users order by created_at desc limit 1;
  if v_principal is null or v_existing_user is null then raise exception 'Dev proof fixtures unavailable.'; end if;

  insert into public.ops_issues(issue_number,issue_type,severity,status,source,title,description,
    recommended_action,dedupe_key,user_id,environment,provenance,queue_key,canonical_status,metadata)
  overriding system value values(-999998,'TAILOR_VERIFICATION','MEDIUM','OPEN','orphan-proof',
    'Orphan proof','Transactional Dev fixture','Investigate missing source.',
    'orphan-proof:'||v_absent_user,v_absent_user,'DEVELOPMENT','QA','trust-safety','NEW','{}'::jsonb)
  returning id,record_version into v_issue,v_version;
  begin
    perform public.close_orphan_verification_case(v_issue,'Source account and profile are absent.',
      v_version,'orphan-proof-no-mfa-0001',v_principal,'dev-orphan-proof','DEVELOPMENT',false,gen_random_uuid());
    raise exception 'Closure accepted without protected assurance.';
  exception when insufficient_privilege then null;
  end;
  v_result := public.close_orphan_verification_case(v_issue,'Source account and profile are absent.',
    v_version,'orphan-proof-success-0001',v_principal,'dev-orphan-proof','DEVELOPMENT',true,gen_random_uuid());
  if v_result->>'receiptOutcome' <> 'SUCCEEDED' then raise exception 'Closure receipt missing.'; end if;
  if not exists(select 1 from public.ops_issues where id=v_issue and canonical_status='RESOLVED')
    or not exists(select 1 from public.ops_case_events where issue_id=v_issue and event_type='STATE_TRANSITION')
    or not exists(select 1 from public.ops_audit_logs where issue_id=v_issue and action_taken='CLOSE_ORPHAN_VERIFICATION')
  then raise exception 'Closure evidence incomplete.'; end if;
  v_result := public.close_orphan_verification_case(v_issue,'Source account and profile are absent.',
    v_version,'orphan-proof-success-0001',v_principal,'dev-orphan-proof','DEVELOPMENT',true,gen_random_uuid());
  if v_result->>'duplicate' <> 'true' then raise exception 'Replay was not idempotent.'; end if;

  insert into public.ops_issues(issue_number,issue_type,severity,status,source,title,description,
    recommended_action,dedupe_key,user_id,environment,provenance,queue_key,canonical_status,metadata)
  overriding system value values(-999997,'TAILOR_VERIFICATION','MEDIUM','OPEN','orphan-proof',
    'Existing account proof','Transactional Dev fixture','Use normal trust review.',
    'orphan-proof-existing:'||v_existing_user,v_existing_user,'DEVELOPMENT','QA','trust-safety','NEW','{}'::jsonb)
  returning id,record_version into v_second_issue,v_second_version;
  begin
    perform public.close_orphan_verification_case(v_second_issue,'Account still exists and must not close.',
      v_second_version,'orphan-proof-existing-0001',v_principal,'dev-orphan-proof','DEVELOPMENT',true,gen_random_uuid());
    raise exception 'Closure accepted with an existing account.';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;
