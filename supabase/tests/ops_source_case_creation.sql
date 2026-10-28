-- Development-only rehearsal; all cases, receipts and outbox effects roll back.
begin;
do $$
declare
  v_principal public.ops_workforce_principals%rowtype;
  v_job uuid := gen_random_uuid();
  v_first jsonb;
  v_second jsonb;
  v_before jsonb;
  v_order text;
  v_key text := gen_random_uuid()::text;
begin
  if public.current_ops_environment() <> 'DEVELOPMENT' then raise exception 'Development only'; end if;
  select * into strict v_principal from public.ops_workforce_principals
    where status='ACTIVE' and 'admin'=any(roles) and access_review_due_at>now()
    order by id limit 1;
  insert into public.job_queue(id,job_type,status,attempt_count,max_attempts)
    values(v_job,'SEND_EMAIL','DEAD',5,5);
  select to_jsonb(j) into v_before from public.job_queue j where id=v_job;
  v_first := public.create_ops_source_case('job',v_job::text,'Rollback-only source case regression.',v_key,
    v_principal.id,v_principal.email,'DEVELOPMENT',gen_random_uuid());
  v_second := public.create_ops_source_case('job',v_job::text,'Rollback-only source case regression.',v_key,
    v_principal.id,v_principal.email,'DEVELOPMENT',gen_random_uuid());
  if v_first->>'receiptId' is null or v_second->>'receiptId' is distinct from v_first->>'receiptId'
    or v_second->>'duplicate' <> 'true' then raise exception 'Idempotent receipt was not retained'; end if;
  v_second := public.create_ops_source_case('job',v_job::text,'Another operator click finds existing review.',gen_random_uuid()::text,
    v_principal.id,v_principal.email,'DEVELOPMENT',gen_random_uuid());
  if v_second->>'existing' <> 'true' or v_second->>'caseId' is distinct from v_first->>'caseId' then
    raise exception 'Existing case was duplicated'; end if;
  if (select to_jsonb(j) from public.job_queue j where id=v_job) is distinct from v_before then
    raise exception 'Review creation mutated the job'; end if;
  if (select count(*) from public.ops_audit_logs where issue_id=(v_first->>'caseId')::uuid and action_taken='CREATE_SOURCE_CASE') <> 1
    or (select count(*) from public.ops_case_events where issue_id=(v_first->>'caseId')::uuid) < 1 then
    raise exception 'Case audit/event is missing or duplicated'; end if;
  begin
    perform public.create_ops_source_case('job',v_job::text,'Reject mismatched environment.',gen_random_uuid()::text,
      v_principal.id,v_principal.email,'PRODUCTION',gen_random_uuid());
    raise exception 'Environment isolation failed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_ops_source_case('job',v_job::text,'Reject spoofed workforce label.',gen_random_uuid()::text,
      v_principal.id,'not-the-actor@example.test','DEVELOPMENT',gen_random_uuid());
    raise exception 'Actor binding failed';
  exception when insufficient_privilege then null; end;
  update public.job_queue set status='SUCCEEDED' where id=v_job;
  begin
    perform public.create_ops_source_case('job',v_job::text,'Reject a now successful source.',gen_random_uuid()::text,
      v_principal.id,v_principal.email,'DEVELOPMENT',gen_random_uuid());
    raise exception 'Source state was not rechecked';
  exception when object_not_in_prerequisite_state then null; end;

  select o.id into v_order from public.orders o where o.stage::text='IN_DISPUTE'
    and not exists(select 1 from public.ops_issues i where i.order_id=o.id::text
      and i.environment='DEVELOPMENT' and i.canonical_status not in ('RESOLVED','CLOSED','CANCELLED'))
    order by o.id limit 1;
  if v_order is null then raise exception 'Missing development disputed-order fixture'; end if;
  select to_jsonb(o) into v_before from public.orders o where id::text=v_order;
  v_first := public.create_ops_source_case('order',v_order,'Rollback-only disputed order ownership.',gen_random_uuid()::text,
    v_principal.id,v_principal.email,'DEVELOPMENT',gen_random_uuid());
  if v_first->>'receiptId' is null then raise exception 'Order creation did not produce a receipt'; end if;
  if (select to_jsonb(o) from public.orders o where id::text=v_order) is distinct from v_before then
    raise exception 'Case creation changed the order'; end if;
  update public.ops_issues set canonical_status='CLOSED',status='RESOLVED'
    where id=(v_first->>'caseId')::uuid;
  v_second := public.create_ops_source_case('order',v_order,'Order still needs review after the previous case closed.',gen_random_uuid()::text,
    v_principal.id,v_principal.email,'DEVELOPMENT',gen_random_uuid());
  if v_second->>'receiptId' is null or v_second->>'caseId' = v_first->>'caseId' then
    raise exception 'Closed case prevented new review of an unresolved dispute'; end if;
  if has_function_privilege('anon','public.create_ops_source_case(text,text,text,text,uuid,text,text,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.create_ops_source_case(text,text,text,text,uuid,text,text,uuid)','EXECUTE') then
    raise exception 'Source repair exposed to a public role'; end if;
end;
$$;
rollback;
