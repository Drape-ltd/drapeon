-- Run after the privacy_data_access_fulfilment migration in a transaction that
-- is rolled back. Uses one existing Dev user and a Dev-only named principal;
-- every export, case, event, receipt, and audit row is synthetic.
do $$
declare
  v_user uuid;
  v_principal uuid;
  v_export uuid;
  v_issue uuid;
  v_version bigint;
  v_result jsonb;
  v_fingerprint text;
begin
  if public.current_ops_environment() <> 'DEVELOPMENT' then
    raise exception 'This proof may run only on Dev.';
  end if;
  select id into v_user from public.users order by created_at desc limit 1;
  select id into v_principal from public.ops_workforce_principals
    where status='ACTIVE' and 'development'=any(permitted_environments)
      and roles && array['admin','customer_success']::text[]
    order by created_at desc limit 1;
  if v_user is null or v_principal is null then raise exception 'Dev proof fixtures unavailable.'; end if;

  insert into public.tailor_data_exports(tailor_user_id,status,export_scope,generated_at,expires_at,metadata)
  values(v_user,'IN_REVIEW','ACCOUNT_ACCESS',now(),now()+interval '1 day',
    jsonb_build_object('export_package',jsonb_build_object('version','proof-v1',
      'sections',jsonb_build_object('account',jsonb_build_object('id',v_user)),
      'generationWarnings','[]'::jsonb))) returning id into v_export;
  insert into public.ops_issues(issue_number,issue_type,severity,status,source,title,description,
    recommended_action,dedupe_key,user_id,environment,provenance,queue_key,canonical_status,metadata)
  overriding system value
  values(-999999,'DATA_ACCESS_REQUEST','MEDIUM','OPEN','privacy-proof','Privacy proof case',
    'Transactional Dev fixture','Review and release complete export.',
    'privacy-proof:'||v_export,v_user,'DEVELOPMENT','QA','privacy-deletion','NEW',
    jsonb_build_object('data_export_id',v_export)) returning id,record_version into v_issue,v_version;

  begin
    perform public.perform_ops_data_access_release(v_issue,v_export,'Reviewed every section',
      v_version,'00000000000000000000000000000000','privacy-proof-no-mfa-0001',v_principal,'dev-privacy-proof','DEVELOPMENT',false,gen_random_uuid());
    raise exception 'Release accepted without protected assurance.';
  exception when insufficient_privilege then null;
  end;
  v_result := public.inspect_ops_data_access_export(v_issue,v_export,v_principal,
    'dev-privacy-proof','DEVELOPMENT',true,gen_random_uuid());
  if v_result->>'exportStatus' <> 'IN_REVIEW' then raise exception 'Inspection state mismatch.'; end if;
  v_fingerprint := v_result->>'exportFingerprint';
  begin
    perform public.perform_ops_data_access_release(v_issue,v_export,'Reviewed every section',
      v_version,'00000000000000000000000000000000','privacy-proof-stale-0001',v_principal,'dev-privacy-proof','DEVELOPMENT',true,gen_random_uuid());
    raise exception 'Release accepted a stale export fingerprint.';
  exception when object_not_in_prerequisite_state then null;
  end;
  v_result := public.perform_ops_data_access_release(v_issue,v_export,'Reviewed every section',
    v_version,v_fingerprint,'privacy-proof-release-0001',v_principal,'dev-privacy-proof','DEVELOPMENT',true,gen_random_uuid());
  if v_result->>'receiptOutcome' <> 'SUCCEEDED' then raise exception 'Release receipt missing.'; end if;
  v_result := public.deliver_data_access_export(v_export,v_user);
  if v_result->>'receiptId' is null then raise exception 'Delivery receipt missing.'; end if;
  if not exists(select 1 from public.tailor_data_exports where id=v_export and status='DELIVERED')
    or not exists(select 1 from public.ops_issues where id=v_issue and canonical_status='RESOLVED')
    or not exists(select 1 from public.ops_case_events where issue_id=v_issue and event_type='EVIDENCE_ACCESS')
    or not exists(select 1 from public.ops_case_events where issue_id=v_issue and event_type='DECISION')
    or not exists(select 1 from public.ops_case_events where issue_id=v_issue and event_type='CUSTOMER_COMMUNICATION')
    or not exists(select 1 from public.ops_audit_logs where issue_id=v_issue and action_taken='DATA_ACCESS_DELIVER')
  then raise exception 'Fulfilment did not persist all terminal evidence.'; end if;
  v_result := public.deliver_data_access_export(v_export,v_user);
  if v_result->>'duplicate' <> 'true' then raise exception 'Delivery replay was not idempotent.'; end if;
end;
$$;
