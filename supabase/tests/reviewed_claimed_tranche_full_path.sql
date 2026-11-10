do $test$
declare
  v_claim uuid;
  v_payout text;
  v_prior uuid;
  v_retry jsonb;
  v_start jsonb;
  v_final jsonb;
  v_replay jsonb;
  v_completed jsonb;
  v_completed_replay jsonb;
  v_attempt uuid;
  v_request uuid := '73000000-0000-4000-8000-000000000001';
begin
  select id,payout_id into v_claim,v_payout from public.payout_claims
    where source_id='00000000-0000-4000-8000-000000000109';
  select id into v_prior from public.payout_provider_operations
    where claim_id=v_claim and operation_number=1;
  if v_claim is null or v_prior is null then
    raise exception 'Initial tranche reservation did not create claim and provider operation';
  end if;
  update public.payout_provider_operations set status='FAILED_RETURNED',
    provider_source_transaction_id='ch_synthetic',
    final_failure_reference='req_synthetic_definite',
    funds_return_reference='NOT_SENT:transfers_not_enabled',
    funds_return_confirmed_at=now() where id=v_prior;
  update public.payout_claims set status='FAILED_RECONCILED',
    transfer_status='FAILED_RECONCILED' where id=v_claim;
  update public.payouts set status='FAILED',failed_at=now(),
    provider_transfer_status='FAILED_RECONCILED' where id=v_payout;
  update public.order_settlement_tranches set status='BLOCKED',payout_id=v_payout
    where id='00000000-0000-4000-8000-000000000109';
  insert into public.money_desk_requests (
    id,action_type,target_type,target_id,order_id,amount,currency,status,
    approved_at,required_approval_count,approval_count,requester_subject,action_payload
  ) values (
    v_request,'POST_RELEASE_RECOVERY','PAYOUT_CLAIM_RETRY',v_claim::text,
    '00000000-0000-4000-8000-000000000101',8400,'USD','EXECUTING',now(),2,2,
    'synthetic-preparer',jsonb_build_object(
      'claimId',v_claim,'trancheId','00000000-0000-4000-8000-000000000109',
      'priorOperationId',v_prior,'provider','STRIPE',
      'destinationId','acct_synthetic','sourceTransaction','ch_synthetic',
      'finalFailureReference','req_synthetic_definite',
      'fundsReturnReference','NOT_SENT:transfers_not_enabled')
  );
  insert into public.money_desk_decisions(request_id,decision,approver_subject)
  values (v_request,'APPROVE','synthetic-approver-one'),
         (v_request,'APPROVE','synthetic-approver-two');
  insert into public.money_desk_execution_attempts(
    request_id,status,executor_email,executor_role
  ) values (v_request,'PROCESSING','executor@example.invalid','FINANCE');
  v_retry:=public.apply_reviewed_claimed_payout_retry(
    v_request,'executor@example.invalid','FINANCE');
  if v_retry->>'outcome'<>'RETRY_READY' then
    raise exception 'Reviewed operation was not reserved: %',v_retry;
  end if;
  v_start:=public.start_payout_attempt(v_claim,'PROVIDER_CALL');
  if v_start->>'action'<>'PROVIDER_CALL'
    or v_start->>'provider_idempotency_key' is distinct from
      'tranche:00000000-0000-4000-8000-000000000109:op:2' then
    raise exception 'Reviewed operation did not start with operation-2 key: %',v_start;
  end if;
  update public.payout_provider_operations set status='TRANSFERRED',
    provider_transfer_id='tr_synthetic_reviewed_retry'
    where id=(v_retry->>'operationId')::uuid;
  update public.payout_claims set status='TRANSFERRED',
    transfer_status='CONFIRMED',provider_transfer_id='tr_synthetic_reviewed_retry'
    where id=v_claim;
  v_final:=public.finalize_claimed_route_tranche_release(
    v_claim,v_payout,'tr_synthetic_reviewed_retry');
  v_replay:=public.finalize_claimed_route_tranche_release(
    v_claim,v_payout,'tr_synthetic_reviewed_retry');
  select id into v_attempt from public.money_desk_execution_attempts
    where request_id=v_request and status='PROCESSING';
  v_completed:=public.complete_money_desk_execution(
    v_attempt,'SUCCEEDED','tr_synthetic_reviewed_retry',null,null);
  v_completed_replay:=public.complete_money_desk_execution(
    v_attempt,'SUCCEEDED','tr_synthetic_reviewed_retry',null,null);
  if v_final->>'outcome'<>'COMPLETED' or v_replay->>'outcome'<>'EXISTING'
    or v_completed->>'status'<>'SUCCEEDED'
    or v_completed_replay->>'duplicate'<>'true'
    or (select status from public.money_desk_requests where id=v_request)<>'SUCCEEDED'
    or (select count(*) from public.money_desk_events
      where request_id=v_request and event_type='EXECUTION_SUCCEEDED')<>1
    or (select count(*) from public.commercial_ledger_entries e
      join public.commercial_ledger_transactions l on l.id=e.transaction_id
      where l.purpose='SETTLEMENT_RELEASE' and e.account_code='TAILOR_RELEASED'
        and e.direction='CREDIT' and e.amount=8400)<>1
    or (select count(*) from public.payout_provider_operations
      where claim_id=v_claim and operation_number=2)<>1
    or (select count(*) from public.payouts
      where settlement_tranche_id='00000000-0000-4000-8000-000000000109')<>1 then
    raise exception 'Reviewed transfer did not finalize one ledger release: %, %',v_final,v_replay;
  end if;
  raise notice 'PASS reviewed operation 2 finalizes one transfer and one ledger release';
end $test$;
rollback;
