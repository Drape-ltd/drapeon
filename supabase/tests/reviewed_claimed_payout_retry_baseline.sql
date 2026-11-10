begin;

insert into public.payout_claims (
  id,business_key,source_kind,source_id,order_id,tailor_profile_id,
  provider,provider_destination_id,currency,amount,route_version,
  earning_policy_version,provider_idempotency_key,status,transfer_status
) values (
  '72000000-0000-4000-8000-000000000010',
  'qa:earning:72000000-0000-4000-8000-000000000010',
  'ORDER_EARNING','72000000-0000-4000-8000-000000000004',
  '72000000-0000-4000-8000-000000000004',
  '72000000-0000-4000-8000-000000000003','STRIPE',
  'acct_qa_same_destination','USD',8400,'qa-route-v1',
  'qa-policy-v1','qa:earning:72000000-0000-4000-8000-000000000010',
  'FAILED_RECONCILED','FAILED_RECONCILED'
);
insert into public.payout_provider_operations (
  claim_id,operation_number,provider,provider_destination_id,currency,amount,
  provider_idempotency_key,status,final_failure_reference,
  funds_return_reference,funds_return_confirmed_at
) values (
  '72000000-0000-4000-8000-000000000010',1,'STRIPE',
  'acct_qa_same_destination','USD',8400,
  'qa:earning:72000000-0000-4000-8000-000000000010',
  'FAILED_RETURNED','req_qa_definite_rejection',
  'NOT_SENT:transfers_not_enabled',now()
);

do $test$
declare v_result jsonb;
begin
  v_result := public.start_payout_attempt(
    '72000000-0000-4000-8000-000000000010','PROVIDER_CALL');
  if v_result->>'action' <> 'BLOCKED' then
    raise exception 'Baseline unexpectedly allows a retry: %',v_result;
  end if;
  if (select count(*) from public.payout_provider_operations
      where claim_id='72000000-0000-4000-8000-000000000010') <> 1 then
    raise exception 'Baseline created a second provider operation';
  end if;
  if (select count(*) from public.payout_attempts
      where claim_id='72000000-0000-4000-8000-000000000010') <> 0 then
    raise exception 'Baseline created a payout attempt';
  end if;
  raise notice 'PASS: definite NOT_SENT rejection is blocked without reviewed retry';
end;
$test$;

rollback;
