begin;
do $$
declare
  v_type text := 'OPS_QA_' || replace(gen_random_uuid()::text,'-','');
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_c uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid(); v_e uuid := gen_random_uuid();
  v_first jsonb; v_next jsonb; v_before jsonb; v_case public.ops_issues%rowtype;
  v_principal public.ops_workforce_principals%rowtype;
begin
  if public.current_ops_environment() <> 'DEVELOPMENT' then raise exception 'Development only'; end if;
  insert into public.job_queue(id,job_type,status,attempt_count,max_attempts)
    select x,v_type,'DEAD',3,3 from unnest(array[v_a,v_b,v_c,v_d,v_e]) x;
  select jsonb_agg(to_jsonb(j) order by id) into v_before from public.job_queue j where job_type=v_type;
  v_first := public.register_ops_job_failure(v_a,'TIMEOUT');
  v_next := public.register_ops_job_failure(v_a,'TIMEOUT');
  if v_next->>'duplicate' <> 'true' or v_next->>'caseId' <> v_first->>'caseId' then raise exception 'Duplicate changed case'; end if;
  update public.ops_issues set canonical_status='IN_PROGRESS',assigned_to='engineering@example.test',first_responded_at=now() where id=(v_first->>'caseId')::uuid;
  select * into v_case from public.ops_issues where id=(v_first->>'caseId')::uuid;
  v_next := public.register_ops_job_failure(v_b,'TIMEOUT');
  if v_next->>'caseId' <> v_first->>'caseId' or (v_next->>'affectedJobCount')::int <> 2 then raise exception 'Same cause did not group'; end if;
  if not exists(select 1 from public.ops_issues where id=v_case.id and canonical_status=v_case.canonical_status
    and assigned_to=v_case.assigned_to and first_responded_at=v_case.first_responded_at
    and first_response_due_at is not distinct from v_case.first_response_due_at
    and active_resolution_due_at is not distinct from v_case.active_resolution_due_at) then raise exception 'Group refresh reset operator state'; end if;
  if (select count(*) from public.ops_audit_logs where issue_id=v_case.id) <> 1 then raise exception 'Repeated failure generated another Slack audit'; end if;
  if (select count(*) from public.ops_case_events where issue_id=v_case.id and event_type='PROVIDER_OUTCOME') <> 2 then raise exception 'Lost per-job evidence'; end if;
  if (select count(*) from public.ops_job_case_links where case_number=v_case.case_number) <> 2 then raise exception 'Missing job-case links'; end if;
  select * into strict v_principal from public.ops_workforce_principals where status='ACTIVE' and 'admin'=any(roles) and access_review_due_at>now() order by id limit 1;
  v_next := public.create_ops_source_case('job',v_b::text,'QA checks existing group ownership.',gen_random_uuid()::text,
    v_principal.id,v_principal.email,'DEVELOPMENT',gen_random_uuid());
  if v_next->>'caseId' <> v_first->>'caseId' or v_next->>'existing' <> 'true' then raise exception 'Manual repair duplicated group'; end if;
  v_next := public.register_ops_job_failure(v_c,'RATE_LIMIT');
  if v_next->>'caseId' = v_first->>'caseId' then raise exception 'Different causes grouped'; end if;
  v_next := public.register_ops_job_failure(v_d,'OTHER');
  if v_next->>'caseId' = (public.register_ops_job_failure(v_e,'OTHER')->>'caseId') then raise exception 'Unknown causes grouped'; end if;
  update public.ops_issues set canonical_status='CLOSED',status='RESOLVED' where id=v_case.id;
  v_next := public.register_ops_job_failure(v_a,'TIMEOUT');
  if v_next->>'caseId' <> v_case.id::text then raise exception 'Repeated old failure reopened review'; end if;
  insert into public.job_queue(id,job_type,status,attempt_count,max_attempts) values(gen_random_uuid(),v_type,'DEAD',3,3) returning id into v_c;
  v_next := public.register_ops_job_failure(v_c,'TIMEOUT');
  if v_next->>'caseId' = v_case.id::text then raise exception 'New failure entered closed review'; end if;
  if (select jsonb_agg(to_jsonb(j) order by id) from public.job_queue j where id=any(array[v_a,v_b,v_d,v_e]))
     is distinct from (select jsonb_agg(x order by x->>'id') from jsonb_array_elements(v_before) x where x->>'id'=any(array[v_a::text,v_b::text,v_d::text,v_e::text])) then raise exception 'Grouping changed job execution'; end if;
  if has_function_privilege('anon','public.register_ops_job_failure(uuid,text)','EXECUTE')
    or has_table_privilege('authenticated','public.ops_job_case_members','SELECT')
    or has_table_privilege('authenticated','public.ops_job_case_links','SELECT') then raise exception 'Grouping exposed publicly'; end if;
end;
$$;
rollback;
