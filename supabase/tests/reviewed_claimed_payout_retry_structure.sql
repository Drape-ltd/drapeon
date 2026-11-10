begin;

insert into public.payout_claims (
  id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
  provider_destination_id,currency,amount,route_version,earning_policy_version,
  provider_idempotency_key
) values (
  '72000000-0000-4000-8000-000000000010',
  'qa:earning:72000000-0000-4000-8000-000000000010','ORDER_EARNING',
  'qa-order','qa-order','qa-tailor','STRIPE','acct_qa_same_destination',
  'USD',8400,'qa-route','qa-policy','qa:earning:72000000-0000-4000-8000-000000000010'
);
update public.payout_claims set status='FAILED_RECONCILED',
  transfer_status='FAILED_RECONCILED'
  where id='72000000-0000-4000-8000-000000000010';
insert into public.payout_provider_operations (
  id,claim_id,operation_number,provider,provider_destination_id,currency,amount,
  provider_idempotency_key,status,provider_source_transaction_id,
  final_failure_reference,funds_return_reference,funds_return_confirmed_at
) values (
  '72000000-0000-4000-8000-000000000011',
  '72000000-0000-4000-8000-000000000010',1,'STRIPE',
  'acct_qa_same_destination','USD',8400,
  'qa:earning:72000000-0000-4000-8000-000000000010',
  'FAILED_RETURNED','ch_qa_source','req_qa_definite_rejection',
  'NOT_SENT:transfers_not_enabled',now()
);
insert into public.money_desk_requests(
  id,action_type,target_type,target_id,order_id,amount,currency,status,
  approved_at,required_approval_count,approval_count,requester_subject,action_payload
) values (
  '72000000-0000-4000-8000-000000000020',
  'POST_RELEASE_RECOVERY','PAYOUT_CLAIM_RETRY',
  '72000000-0000-4000-8000-000000000010','qa-order',8400,'USD',
  'EXECUTING',now(),2,2,'qa-preparer',
  '{"claimId":"72000000-0000-4000-8000-000000000010",
    "priorOperationId":"72000000-0000-4000-8000-000000000011",
    "provider":"STRIPE","destinationId":"acct_qa_same_destination",
    "sourceTransaction":"ch_qa_source",
    "finalFailureReference":"req_qa_definite_rejection",
    "fundsReturnReference":"NOT_SENT:transfers_not_enabled"}'::jsonb
);
insert into public.money_desk_decisions(request_id,decision,approver_subject)
values
  ('72000000-0000-4000-8000-000000000020','APPROVE','qa-approver-one'),
  ('72000000-0000-4000-8000-000000000020','APPROVE','qa-approver-two');
insert into public.money_desk_execution_attempts(request_id,status)
values ('72000000-0000-4000-8000-000000000020','PROCESSING');

create function pg_temp.try_reviewed_retry_authorization()
returns text language plpgsql as $test$
begin
  insert into public.payout_claim_retry_authorizations (
    id,claim_id,prior_operation_id,money_desk_request_id,operation_number,
    provider,provider_destination_id,currency,amount,provider_source_transaction_id,
    final_failure_reference,funds_return_reference
  ) values (
    '72000000-0000-4000-8000-000000000022',
    '72000000-0000-4000-8000-000000000010',
    '72000000-0000-4000-8000-000000000011',
    '72000000-0000-4000-8000-000000000020',2,'STRIPE',
    'acct_qa_same_destination','USD',8400,'ch_qa_source',
    'req_qa_definite_rejection','NOT_SENT:transfers_not_enabled'
  );
  return 'ALLOWED';
exception when others then
  return sqlerrm;
end;
$test$;

do $test$
begin
  update public.money_desk_requests set status='PENDING_APPROVAL',
    approved_at=null,approval_count=0
    where id='72000000-0000-4000-8000-000000000020';
  if pg_temp.try_reviewed_retry_authorization()
      not like '%executing two-person Money Desk request%' then
    raise exception 'Unapproved retry was not blocked';
  end if;
  update public.money_desk_requests set status='EXECUTING',
    approved_at=now(),approval_count=2
    where id='72000000-0000-4000-8000-000000000020';

  update public.money_desk_decisions set approver_subject='qa-approver-one'
    where approver_subject='qa-approver-two';
  if pg_temp.try_reviewed_retry_authorization()
      not like '%two distinct non-requester approvers%' then
    raise exception 'Repeated approver was not blocked';
  end if;
  update public.money_desk_decisions set approver_subject='qa-preparer'
    where approver_subject='qa-approver-one' and ctid=(
      select ctid from public.money_desk_decisions limit 1);
  if pg_temp.try_reviewed_retry_authorization()
      not like '%two distinct non-requester approvers%' then
    raise exception 'Preparer approval was not blocked';
  end if;
  update public.money_desk_decisions set approver_subject='qa-approver-two'
    where approver_subject='qa-preparer';

  update public.money_desk_requests set amount=8300
    where id='72000000-0000-4000-8000-000000000020';
  if pg_temp.try_reviewed_retry_authorization()
      not like '%approved order, amount or provider evidence%' then
    raise exception 'Wrong approved amount was not blocked';
  end if;
  update public.money_desk_requests set amount=8400
    where id='72000000-0000-4000-8000-000000000020';

  update public.payout_provider_operations set final_failure_reference=null
    where id='72000000-0000-4000-8000-000000000011';
  if pg_temp.try_reviewed_retry_authorization()
      not like '%definite not-sent rejection%' then
    raise exception 'Missing provider failure evidence was not blocked';
  end if;
  update public.payout_provider_operations
    set final_failure_reference='req_qa_definite_rejection'
    where id='72000000-0000-4000-8000-000000000011';
  raise notice 'PASS unapproved, repeated, preparer, amount and missing-evidence rejections';
end;
$test$;

insert into public.payout_claim_retry_authorizations (
  id,claim_id,prior_operation_id,money_desk_request_id,operation_number,
  provider,provider_destination_id,currency,amount,provider_source_transaction_id,
  final_failure_reference,funds_return_reference
) values (
  '72000000-0000-4000-8000-000000000021',
  '72000000-0000-4000-8000-000000000010',
  '72000000-0000-4000-8000-000000000011',
  '72000000-0000-4000-8000-000000000020',2,'STRIPE',
  'acct_qa_same_destination','USD',8400,'ch_qa_source',
  'req_qa_definite_rejection','NOT_SENT:transfers_not_enabled'
);
do $test$
begin
  begin
    insert into public.payout_provider_operations (
      claim_id,operation_number,provider,provider_destination_id,currency,amount,
      provider_idempotency_key,status,provider_source_transaction_id,
      money_desk_request_id,reviewed_retry_id
    ) values (
      '72000000-0000-4000-8000-000000000010',2,'STRIPE',
      'acct_qa_wrong_destination','USD',8400,
      'qa:earning:72000000-0000-4000-8000-000000000010:op:2',
      'RESERVED','ch_qa_source',
      '72000000-0000-4000-8000-000000000020',
      '72000000-0000-4000-8000-000000000021'
    );
    raise exception 'Mismatched reviewed retry operation was inserted';
  exception when others then
    if sqlerrm not like '%Reviewed retry is for a different provider operation%' then
      raise;
    end if;
  end;
  raise notice 'PASS reviewed retry operation rejects a different destination';
end;
$test$;
insert into public.payout_provider_operations (
  claim_id,operation_number,provider,provider_destination_id,currency,amount,
  provider_idempotency_key,status,provider_source_transaction_id,
  money_desk_request_id,reviewed_retry_id
) values (
  '72000000-0000-4000-8000-000000000010',2,'STRIPE',
  'acct_qa_same_destination','USD',8400,
  'qa:earning:72000000-0000-4000-8000-000000000010:op:2',
  'RESERVED','ch_qa_source',
  '72000000-0000-4000-8000-000000000020',
  '72000000-0000-4000-8000-000000000021'
);
update public.payout_provider_operations set status='PROVIDER_UNKNOWN'
  where claim_id='72000000-0000-4000-8000-000000000010'
    and operation_number=2;
do $test$
begin
  if (select count(*) from public.payout_attempts
      where claim_id='72000000-0000-4000-8000-000000000010') <> 1 then
    raise exception 'Direct operation start did not prepare one payout attempt';
  end if;
  raise notice 'PASS direct operation start prepares one attempt';
end;
$test$;

do $test$
begin
  begin
    update public.payout_provider_operations
      set reviewed_retry_id=null,
        reviewed_correction_id='72000000-0000-4000-8000-000000000023'
      where claim_id='72000000-0000-4000-8000-000000000010'
        and operation_number=2;
    raise exception 'Operation 2 review identity was rewritable';
  exception when others then
    if sqlerrm not like '%Provider operation identity cannot change%' then
      raise;
    end if;
  end;
  raise notice 'PASS operation 2 review identity is immutable';
end;
$test$;

do $test$
begin
  if (select count(*) from public.payout_provider_operations
      where operation_number=2 and reviewed_retry_id is not null
        and reviewed_correction_id is null) <> 1 then
    raise exception 'Same-destination reviewed operation did not satisfy structure';
  end if;
  if not (select relrowsecurity from pg_class
      where oid='public.payout_claim_retry_authorizations'::regclass) then
    raise exception 'Retry authorization table lacks RLS';
  end if;
  if has_table_privilege('anon','public.payout_claim_retry_authorizations','SELECT')
    or has_table_privilege('authenticated','public.payout_claim_retry_authorizations','SELECT')
    or not has_table_privilege('service_role','public.payout_claim_retry_authorizations','SELECT') then
    raise exception 'Retry authorization grants are incorrect';
  end if;
  raise notice 'PASS structural retry authorization and service-role grants';
end;
$test$;

-- Exercise the supported RPC on a separate definite-not-sent claim. Replaying
-- the same approved request must return operation 2, not reserve operation 3.
insert into public.payout_claims (
  id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
  provider_destination_id,currency,amount,route_version,earning_policy_version,
  provider_idempotency_key
) values (
  '72000000-0000-4000-8000-000000000030','qa:earning:retry-rpc',
  'ORDER_EARNING','qa-order-rpc','qa-order-rpc','qa-tailor','STRIPE',
  'acct_qa_same_destination','USD',8400,'qa-route','qa-policy',
  'qa:earning:retry-rpc'
);
update public.payout_claims set status='FAILED_RECONCILED',
  transfer_status='FAILED_RECONCILED'
  where id='72000000-0000-4000-8000-000000000030';
insert into public.payout_provider_operations (
  id,claim_id,operation_number,provider,provider_destination_id,currency,amount,
  provider_idempotency_key,status,provider_source_transaction_id,
  final_failure_reference,funds_return_reference,funds_return_confirmed_at
) values (
  '72000000-0000-4000-8000-000000000031',
  '72000000-0000-4000-8000-000000000030',1,'STRIPE',
  'acct_qa_same_destination','USD',8400,'qa:earning:retry-rpc',
  'FAILED_RETURNED','ch_qa_source','req_qa_definite_rejection',
  'NOT_SENT:transfers_not_enabled',now()
);
insert into public.money_desk_requests (
  id,action_type,target_type,target_id,order_id,amount,currency,status,
  approved_at,required_approval_count,approval_count,requester_subject,action_payload
) values (
  '72000000-0000-4000-8000-000000000032','POST_RELEASE_RECOVERY',
  'PAYOUT_CLAIM_RETRY','72000000-0000-4000-8000-000000000030',
  'qa-order-rpc',8400,'USD','EXECUTING',now(),2,2,'qa-preparer',
  '{"claimId":"72000000-0000-4000-8000-000000000030",
    "priorOperationId":"72000000-0000-4000-8000-000000000031",
    "provider":"STRIPE","destinationId":"acct_qa_same_destination",
    "sourceTransaction":"ch_qa_source",
    "finalFailureReference":"req_qa_definite_rejection",
    "fundsReturnReference":"NOT_SENT:transfers_not_enabled"}'::jsonb
);
insert into public.money_desk_decisions(request_id,decision,approver_subject)
values
  ('72000000-0000-4000-8000-000000000032','APPROVE','qa-approver-one'),
  ('72000000-0000-4000-8000-000000000032','APPROVE','qa-approver-two');
insert into public.money_desk_execution_attempts (
  request_id,status,executor_email,executor_role
) values (
  '72000000-0000-4000-8000-000000000032','PROCESSING',
  'qa-executor@example.invalid','FINANCE'
);
do $test$
declare
  v_first jsonb;
  v_replay jsonb;
  v_start jsonb;
begin
  v_first := public.apply_reviewed_claimed_payout_retry(
    '72000000-0000-4000-8000-000000000032',
    'qa-executor@example.invalid','FINANCE');
  v_replay := public.apply_reviewed_claimed_payout_retry(
    '72000000-0000-4000-8000-000000000032',
    'qa-executor@example.invalid','FINANCE');
  if v_first->>'outcome' <> 'RETRY_READY'
    or v_replay->>'outcome' <> 'EXISTING'
    or v_first->>'operationId' is distinct from v_replay->>'operationId'
    or v_first->>'providerKey' <> 'qa:earning:retry-rpc:op:2'
    or (select count(*) from public.payout_provider_operations
        where claim_id='72000000-0000-4000-8000-000000000030') <> 2
    or (select count(*) from public.payout_claim_retry_authorizations
        where claim_id='72000000-0000-4000-8000-000000000030') <> 1
    or (select status from public.payout_claims
        where id='72000000-0000-4000-8000-000000000030') <> 'RESERVED' then
    raise exception 'Reviewed retry RPC did not reserve exactly one new operation';
  end if;
  v_start := public.start_payout_attempt(
    '72000000-0000-4000-8000-000000000030','PROVIDER_CALL');
  if v_start->>'action' <> 'PROVIDER_CALL'
    or v_start->>'reviewed_retry_id' is distinct from v_first->>'reviewedRetryId'
    or v_start->>'provider_idempotency_key' <> 'qa:earning:retry-rpc:op:2'
    or (select count(*) from public.payout_attempts
        where claim_id='72000000-0000-4000-8000-000000000030') <> 1 then
    raise exception 'Reviewed retry start did not preserve one attempt and review identity';
  end if;
  raise notice 'PASS reviewed retry RPC reserves operation 2 and replays once';
end;
$test$;

rollback;
