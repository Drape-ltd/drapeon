begin;
do $$
declare
  v_run uuid := gen_random_uuid();
  v_payment uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_bad_request uuid := gen_random_uuid();
  v_next_request uuid := gen_random_uuid();
  v_prior text := 're_failed_fixture';
  v_result jsonb;
  v_operation uuid;
  v_job uuid;
begin
  insert into public.order_fulfillment_runs(id,order_id,currency,customer_refund_amount,
    customer_refund_tax_amount,customer_refund_status)
  values(v_run,'fixture-order','USD',300,0,'FAILED');
  begin
    update public.order_fulfillment_runs set customer_provider_refund_id='pi_wrong'
      where id=v_run;
    raise exception 'payment intent was accepted as a refund ID';
  exception when check_violation then null;
  end;
  insert into public.order_payments(id,order_id,provider,phase,currency,status,amount,
    refunded_amount,provider_payment_id)
  values(v_payment,'fixture-order','STRIPE','INITIAL_ORDER','USD','SUCCEEDED',13531,0,'pi_fixture');
  insert into public.ops_issues(dedupe_key,status,order_id,metadata)
  values('stripe-refund-failed:'||v_prior,'IN_REVIEW','fixture-order',
    jsonb_build_object('payment_id',v_payment,'refund_resolution_id','dispatch-refund:'||v_run,
      'refund_amount',300));
  insert into public.money_desk_requests(id,action_type,target_type,target_id,order_id,
    amount,currency,status,action_payload,requester_email,reason,approval_count,
    required_approval_count,approved_at)
  values(v_request,'CUSTOMER_REFUND','DISPATCH_REFUND_RETRY',v_run::text,
    'fixture-order',300,'USD','EXECUTING',
    jsonb_build_object('priorRefundId',v_prior,'priorRefundStatus','failed','paymentId',v_payment),
    'preparer@example.invalid','Reviewed terminal provider failure',2,2,now());
  insert into public.money_desk_decisions(request_id,decision,approver_email)
  values(v_request,'APPROVE','approver1@example.invalid'),
        (v_request,'APPROVE','approver2@example.invalid');
  insert into public.money_desk_execution_attempts(request_id,status)
  values(v_request,'PROCESSING');

  -- A request with its preparer counted as an approver cannot queue money.
  insert into public.money_desk_requests(id,action_type,target_type,target_id,order_id,
    amount,currency,status,action_payload,requester_email,reason,approval_count,
    required_approval_count,approved_at)
  select v_bad_request,action_type,target_type,target_id,order_id,amount,currency,status,
    action_payload,requester_email,reason,approval_count,required_approval_count,approved_at
  from public.money_desk_requests where id=v_request;
  insert into public.money_desk_decisions(request_id,decision,approver_email)
  values(v_bad_request,'APPROVE','preparer@example.invalid'),
        (v_bad_request,'APPROVE','approver2@example.invalid');
  insert into public.money_desk_execution_attempts(request_id,status)
  values(v_bad_request,'PROCESSING');
  select public.queue_reviewed_dispatch_refund_retry(v_bad_request,'executor@example.invalid','ADMIN')
    into v_result;
  if v_result->>'outcome' <> 'INSUFFICIENT_INDEPENDENT_APPROVALS' then
    raise exception 'preparer approval was accepted: %',v_result;
  end if;

  update public.money_desk_requests set amount=301 where id=v_request;
  select public.queue_reviewed_dispatch_refund_retry(v_request,'executor@example.invalid','ADMIN')
    into v_result;
  if v_result->>'outcome' <> 'RUN_SNAPSHOT_MISMATCH' then
    raise exception 'wrong amount was accepted: %',v_result;
  end if;
  update public.money_desk_requests set amount=300 where id=v_request;

  select public.queue_reviewed_dispatch_refund_retry(v_request,'executor@example.invalid','ADMIN')
    into v_result;
  if v_result->>'outcome' <> 'QUEUED' then
    raise exception 'approved retry was not queued: %',v_result;
  end if;
  v_operation := (v_result->>'operationId')::uuid;
  v_job := (v_result->>'jobId')::uuid;
  if (select count(*) from public.job_queue where id=v_job and status='PENDING'
      and payload->>'dispatchRetryOperationId'=v_operation::text) <> 1 then
    raise exception 'queued job is missing its operation binding';
  end if;
  if (select count(*) from public.ops_audit_logs where action_taken='QUEUE_REVIEWED_DISPATCH_REFUND_RETRY'
      and after_state->>'operationId'=v_operation::text) <> 1 then
    raise exception 'approved retry audit is missing';
  end if;
  select public.queue_reviewed_dispatch_refund_retry(v_request,'executor@example.invalid','ADMIN')
    into v_result;
  if v_result->>'outcome' <> 'EXISTING' or (v_result->>'operationId')::uuid <> v_operation
    or (select count(*) from public.job_queue) <> 1 then
    raise exception 'request replay created a second operation or job: %',v_result;
  end if;
  begin
    update public.dispatch_refund_retry_operations
      set prior_refund_id='re_changed' where id=v_operation;
    raise exception 'immutable prior refund changed';
  exception when raise_exception then
    if sqlerrm <> 'DISPATCH_RETRY_TRANSITION_UNSAFE' then raise; end if;
  end;

  -- A second attempt is possible only after the first retry's provider
  -- outcome is terminally failed and a new, independently approved request
  -- identifies that new failed refund.
  update public.dispatch_refund_retry_operations
    set status='FAILED',provider_refund_id='re_retry_failed' where id=v_operation;
  update public.job_queue set status='DEAD' where id=v_job;
  insert into public.ops_issues(dedupe_key,status,order_id,metadata)
  values('stripe-refund-failed:re_retry_failed','OPEN','fixture-order',
    jsonb_build_object('payment_id',v_payment,'refund_resolution_id','dispatch-refund:'||v_run,
      'refund_amount',300));
  insert into public.money_desk_requests(id,action_type,target_type,target_id,order_id,
    amount,currency,status,action_payload,requester_email,reason,approval_count,
    required_approval_count,approved_at)
  select v_next_request,action_type,target_type,target_id,order_id,amount,currency,status,
    jsonb_build_object('priorRefundId','re_retry_failed','priorRefundStatus','failed',
      'paymentId',v_payment),requester_email,reason,approval_count,
    required_approval_count,approved_at
  from public.money_desk_requests where id=v_request;
  insert into public.money_desk_decisions(request_id,decision,approver_email)
  values(v_next_request,'APPROVE','approver1@example.invalid'),
        (v_next_request,'APPROVE','approver2@example.invalid');
  insert into public.money_desk_execution_attempts(request_id,status)
  values(v_next_request,'PROCESSING');
  select public.queue_reviewed_dispatch_refund_retry(v_next_request,'executor@example.invalid','ADMIN')
    into v_result;
  if v_result->>'outcome' <> 'QUEUED' or (v_result->>'attemptNumber')::integer <> 3
    or (select count(*) from public.job_queue) <> 2 then
    raise exception 'new reviewed attempt did not queue after terminal failure: %',v_result;
  end if;
  raise notice 'PASS reviewed dispatch refund retry: independent approval, exact amount, queue, audit, replay, immutability, new operation after terminal failure';
end $$;
rollback;
