-- Run after the candidate migration, inside a rolled-back development transaction.
do $$
declare
  v_parent uuid:=gen_random_uuid(); v_child uuid:=gen_random_uuid();
  v_receipt uuid:=gen_random_uuid(); v_case uuid; v_result jsonb; v_before jsonb;
  v_example record;
begin
  if public.current_ops_environment()<>'DEVELOPMENT' then raise exception 'Development only'; end if;
  insert into public.job_queue(id,job_type,status,attempt_count,max_attempts)
    values(v_parent,'OPS_RECOVERY_QA_'||v_parent::text,'DEAD',3,3),
      (v_child,'RECONCILE_PAYMENT_WEBHOOK','PENDING',0,3);
  v_result:=public.register_ops_job_failure(v_parent,'OTHER');
  v_case:=(v_result->>'caseId')::uuid;
  select to_jsonb(j) into v_before from public.job_queue j where id=v_parent;
  insert into public.ops_action_receipts(id,issue_id,action_key,idempotency_key,expected_record_version,human_status)
    values(v_receipt,v_case,'RETRY_JOB',v_receipt::text,1,'Recovery queued');
  insert into public.ops_job_recoveries(issue_id,receipt_id,original_job_id,recovery_job_id,environment)
    values(v_case,v_receipt,v_parent,v_child,'DEVELOPMENT');
  begin
    perform public.complete_ops_job_recovery(v_child,'RECOVERED','{"matched":true,"mode":"STRIPE_EVENT_RETRIEVE"}');
    raise exception 'Pending worker accepted';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    update public.ops_issues set canonical_status='RESOLVED',status='RESOLVED' where id=v_case;
    raise exception 'Closed case during recovery';
  exception when object_not_in_prerequisite_state then null; end;
  update public.job_queue set status='SUCCEEDED',completed_at=now() where id=v_child;
  v_result:=public.complete_ops_job_recovery(v_child,'RECOVERED',
    '{"matched":true,"mode":"PAYSTACK_SIGNED_EVENT_NO_RETRIEVAL_ENDPOINT"}');
  if v_result->>'outcome'<>'REVIEW_REQUIRED' then raise exception 'Unverified fallback claimed recovery'; end if;
  if (select outcome from public.ops_action_receipts where id=v_receipt)<>'FAILED' then raise exception 'False success receipt'; end if;
  v_result:=public.complete_ops_job_recovery(v_child,'RECOVERED','{"matched":true,"mode":"STRIPE_EVENT_RETRIEVE"}');
  if v_result->>'duplicate'<>'true' or v_result->>'outcome'<>'REVIEW_REQUIRED' then raise exception 'Terminal outcome overwritten'; end if;
  if (select canonical_status from public.ops_issues where id=v_case) in ('RESOLVED','CLOSED','CANCELLED') then raise exception 'Recovery closed case'; end if;
  if v_before is distinct from (select to_jsonb(j) from public.job_queue j where id=v_parent) then raise exception 'Original evidence changed'; end if;
  for v_example in select * from (values
    ('RECONCILE_PAYMENT_WEBHOOK','SUCCEEDED','{"matched":true,"mode":"STRIPE_EVENT_RETRIEVE"}'::jsonb,'RECOVERED'),
    ('RECONCILE_PAYMENT_WEBHOOK','SUCCEEDED','{"matched":false,"mode":"STRIPE_EVENT_RETRIEVE"}'::jsonb,'REVIEW_REQUIRED'),
    ('RECONCILE_PAYMENT_WEBHOOK','SUCCEEDED','{}'::jsonb,'REVIEW_REQUIRED'),
    ('RECONCILE_PAYMENT_WEBHOOK','DEAD','{"matched":true,"mode":"STRIPE_EVENT_RETRIEVE"}'::jsonb,'FAILED'),
    ('RECONCILE_DELIVERY_WEBHOOK','SUCCEEDED','{"matched":true,"reason":"DISPATCH_EVENT_MATCHED","orderId":"o","fulfillmentEventId":"f"}'::jsonb,'RECOVERED'),
    ('RECONCILE_DELIVERY_WEBHOOK','SUCCEEDED','{"matched":true,"reason":"TERMINAL_SKIP:not_financial_evidence"}'::jsonb,'REVIEW_REQUIRED'),
    ('SEND_EMAIL','SUCCEEDED','{"matched":true,"mode":"STRIPE_EVENT_RETRIEVE"}'::jsonb,'REVIEW_REQUIRED')
  ) as cases(job_type,job_status,result,expected) loop
    v_child:=gen_random_uuid(); v_receipt:=gen_random_uuid();
    insert into public.job_queue(id,job_type,status) values(v_child,v_example.job_type,v_example.job_status);
    insert into public.ops_action_receipts(id,issue_id,action_key,idempotency_key,expected_record_version,human_status)
      values(v_receipt,v_case,'RETRY_JOB',v_receipt::text,1,'Recovery queued');
    insert into public.ops_job_recoveries(issue_id,receipt_id,original_job_id,recovery_job_id,environment)
      values(v_case,v_receipt,v_parent,v_child,'DEVELOPMENT');
    v_result:=public.complete_ops_job_recovery(v_child,'RECOVERED',v_example.result);
    if v_result->>'outcome' is distinct from v_example.expected then
      raise exception 'Wrong outcome for %: %',v_example.job_type,v_result; end if;
    if (select outcome from public.ops_action_receipts where id=v_receipt) is distinct from
      (case when v_example.expected='RECOVERED' then 'SUCCEEDED' else 'FAILED' end) then
      raise exception 'Receipt disagrees with recovery'; end if;
  end loop;
  if has_table_privilege('authenticated','public.ops_job_recoveries','SELECT')
    or has_function_privilege('anon','public.complete_ops_job_recovery(uuid,text,jsonb)','EXECUTE') then
    raise exception 'Recovery exposed to public client'; end if;
  -- A watchdog terminal transition must also settle the pending receipt.
  v_child:=gen_random_uuid(); v_receipt:=gen_random_uuid();
  insert into public.job_queue(id,job_type,status) values(v_child,'RECONCILE_PAYMENT_WEBHOOK','PROCESSING');
  insert into public.ops_action_receipts(id,issue_id,action_key,idempotency_key,expected_record_version,human_status)
    values(v_receipt,v_case,'RETRY_JOB',v_receipt::text,1,'Recovery queued');
  insert into public.ops_job_recoveries(issue_id,receipt_id,original_job_id,recovery_job_id,environment)
    values(v_case,v_receipt,v_parent,v_child,'DEVELOPMENT');
  update public.job_queue set status='DEAD' where id=v_child;
  if (select outcome from public.ops_action_receipts where id=v_receipt)<>'FAILED'
    or (select outcome from public.ops_job_recoveries where recovery_job_id=v_child)<>'FAILED' then
    raise exception 'Watchdog failure left pending recovery'; end if;
end;
$$;

do $$
declare
  v_actor public.ops_workforce_principals%rowtype;
  v_issue public.ops_issues%rowtype;
  v_job uuid:=gen_random_uuid(); v_event uuid:=gen_random_uuid(); v_key text:=gen_random_uuid()::text;
  v_result jsonb; v_again jsonb; v_before jsonb;
begin
  select * into strict v_actor from public.ops_workforce_principals where status='ACTIVE'
    and 'admin'=any(roles) and access_review_due_at>now() order by id limit 1;
  insert into public.payment_webhook_events(id,provider,provider_event_id,event_type,signature_valid,processed_at)
    values(v_event,'STRIPE','ops-recovery-qa-'||v_event::text,'payment_intent.succeeded',true,now());
  insert into public.job_queue(id,job_type,status,attempt_count,max_attempts,payload)
    values(v_job,'RECONCILE_PAYMENT_WEBHOOK','DEAD',3,3,jsonb_build_object('webhookEventId',v_event,'provider','STRIPE','untrustedExtra','must not copy'));
  v_result:=public.register_ops_job_failure(v_job,'OTHER');
  select * into v_issue from public.ops_issues where id=(v_result->>'caseId')::uuid;
  select to_jsonb(j) into v_before from public.job_queue j where id=v_job;
  begin
    perform public.request_ops_job_recovery(v_issue.id,gen_random_uuid(),'Recheck synthetic event after fixing the cause.',v_issue.record_version,
      v_key,v_actor.id,v_actor.email,'DEVELOPMENT',gen_random_uuid());
    raise exception 'Unlinked job accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.request_ops_job_recovery(v_issue.id,v_job,'Recheck synthetic event after fixing the cause.',v_issue.record_version,
      v_key,v_actor.id,v_actor.email,'PRODUCTION',gen_random_uuid());
    raise exception 'Cross-environment recovery accepted';
  exception when insufficient_privilege then null; end;
  if public.get_ops_job_recovery_context(v_issue.id,v_job,'PRODUCTION') is not null
    or public.get_ops_job_recovery_context(v_issue.id,gen_random_uuid(),'DEVELOPMENT') is not null then
    raise exception 'Unlinked or cross-environment context exposed'; end if;
  begin
    perform public.request_ops_job_recovery(v_issue.id,v_job,'Recheck synthetic event after fixing the cause.',v_issue.record_version,
      v_key,v_actor.id,'spoof@example.test','DEVELOPMENT',gen_random_uuid());
    raise exception 'Spoofed actor accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.request_ops_job_recovery(v_issue.id,v_job,'Recheck synthetic event after fixing the cause.',v_issue.record_version+1,
      v_key,v_actor.id,v_actor.email,'DEVELOPMENT',gen_random_uuid());
    raise exception 'Stale version accepted';
  exception when serialization_failure then null; end;
  v_result:=public.request_ops_job_recovery(v_issue.id,v_job,'Recheck synthetic event after fixing the cause.',v_issue.record_version,
    v_key,v_actor.id,v_actor.email,'DEVELOPMENT',gen_random_uuid());
  v_again:=public.request_ops_job_recovery(v_issue.id,v_job,'Recheck synthetic event after fixing the cause.',v_issue.record_version,
    v_key,v_actor.id,v_actor.email,'DEVELOPMENT',gen_random_uuid());
  if v_result->>'receiptOutcome'<>'PENDING' or v_again->>'duplicate'<>'true'
    or v_again->>'receiptId' is distinct from v_result->>'receiptId' then raise exception 'Not idempotent'; end if;
  select * into v_issue from public.ops_issues where id=v_issue.id;
  begin
    perform public.request_ops_job_recovery(v_issue.id,v_job,'Recheck synthetic event after fixing the cause.',v_issue.record_version,
      gen_random_uuid()::text,v_actor.id,v_actor.email,'DEVELOPMENT',gen_random_uuid());
    raise exception 'Second pending recovery accepted';
  exception when object_not_in_prerequisite_state then null; end;
  if (select payload from public.job_queue where id=(v_result->>'recoveryJobId')::uuid)
    is distinct from jsonb_build_object('webhookEventId',v_event,'provider','STRIPE') then raise exception 'Unsafe payload copied'; end if;
  if v_before is distinct from (select to_jsonb(j) from public.job_queue j where id=v_job) then raise exception 'Original job reset'; end if;
  if (select max_attempts from public.job_queue where id=(v_result->>'recoveryJobId')::uuid)<>3 then raise exception 'Unbounded retry'; end if;
  update public.job_queue set status='PROCESSING',locked_by='recovery-qa',locked_at=now(),attempt_count=1
    where id=(v_result->>'recoveryJobId')::uuid;
  -- A receipt consistency failure must roll back the job's terminal transition.
  update public.ops_action_receipts set outcome='FAILED',completed_at=now() where id=(v_result->>'receiptId')::uuid;
  begin
    perform public.finish_ops_reconciliation_job((v_result->>'recoveryJobId')::uuid,'recovery-qa',true,null,10,
      '{"matched":true,"mode":"STRIPE_EVENT_RETRIEVE"}');
    raise exception 'Inconsistent receipt accepted';
  exception when object_not_in_prerequisite_state then null; end;
  if (select status from public.job_queue where id=(v_result->>'recoveryJobId')::uuid)<>'PROCESSING'
    or exists(select 1 from public.job_attempts where job_id=(v_result->>'recoveryJobId')::uuid) then
    raise exception 'Job finished without receipt'; end if;
  update public.ops_action_receipts set outcome='PENDING',completed_at=null where id=(v_result->>'receiptId')::uuid;
  perform public.finish_ops_reconciliation_job((v_result->>'recoveryJobId')::uuid,'recovery-qa',true,null,10,
    '{"matched":true,"mode":"STRIPE_EVENT_RETRIEVE"}');
  if (select status from public.job_queue where id=(v_result->>'recoveryJobId')::uuid)<>'SUCCEEDED'
    or (select outcome from public.ops_action_receipts where id=(v_result->>'receiptId')::uuid)<>'SUCCEEDED' then
    raise exception 'Atomic successful completion missing'; end if;
  select * into v_issue from public.ops_issues where id=v_issue.id;
  begin
    perform public.request_ops_job_recovery(v_issue.id,v_job,'Recheck synthetic event after fixing the cause.',v_issue.record_version,
      gen_random_uuid()::text,v_actor.id,v_actor.email,'DEVELOPMENT',gen_random_uuid());
    raise exception 'Already recovered job accepted';
  exception when object_not_in_prerequisite_state then null; end;
end;
$$;

do $$
declare
  v_actor public.ops_workforce_principals%rowtype;
  v_issue public.ops_issues%rowtype;
  v_job uuid:=gen_random_uuid(); v_event uuid:=gen_random_uuid(); v_result jsonb; v_attempt integer;
begin
  if public.current_ops_environment()<>'DEVELOPMENT' then raise exception 'Development only'; end if;
  select * into strict v_actor from public.ops_workforce_principals where status='ACTIVE'
    and 'admin'=any(roles) and access_review_due_at>now() order by id limit 1;
  insert into public.payment_webhook_events(id,provider,provider_event_id,event_type,signature_valid,processed_at)
    values(v_event,'STRIPE','ops-recovery-limit-qa-'||v_event::text,'payment_intent.succeeded',true,now());
  insert into public.job_queue(id,job_type,status,attempt_count,max_attempts,payload)
    values(v_job,'RECONCILE_PAYMENT_WEBHOOK','DEAD',3,3,jsonb_build_object('webhookEventId',v_event,'provider','STRIPE'));
  v_result:=public.register_ops_job_failure(v_job,'OTHER');
  select * into v_issue from public.ops_issues where id=(v_result->>'caseId')::uuid;
  for v_attempt in 1..3 loop
    select * into v_issue from public.ops_issues where id=v_issue.id;
    v_result:=public.request_ops_job_recovery(v_issue.id,v_job,'Development fixture: verify bounded failed recoveries.',v_issue.record_version,
      gen_random_uuid()::text,v_actor.id,v_actor.email,'DEVELOPMENT',gen_random_uuid());
    update public.job_queue set status='DEAD' where id=(v_result->>'recoveryJobId')::uuid;
  end loop;
  select * into v_issue from public.ops_issues where id=v_issue.id;
  begin
    perform public.request_ops_job_recovery(v_issue.id,v_job,'Development fixture: reject the fourth recovery.',v_issue.record_version,
      gen_random_uuid()::text,v_actor.id,v_actor.email,'DEVELOPMENT',gen_random_uuid());
    raise exception 'Fourth recovery accepted';
  exception when object_not_in_prerequisite_state then null; end;
  if (select count(*) from public.ops_job_recoveries where original_job_id=v_job)<>3 then
    raise exception 'Recovery limit did not preserve exactly three attempts'; end if;
end;
$$;
