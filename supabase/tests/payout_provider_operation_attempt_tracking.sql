-- Rollback-only database proof for provider-operation linkage and forward-only
-- outcomes. Synthetic identity only; no provider call or notification is made.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('71000000-0000-4000-8000-000000000001','authenticated','authenticated','operation-customer@example.invalid','',now(),'{}','{}',now(),now()),
  ('71000000-0000-4000-8000-000000000002','authenticated','authenticated','operation-tailor@example.invalid','',now(),'{}','{}',now(),now());

insert into public.customer_profiles (user_id,display_name)
values ('71000000-0000-4000-8000-000000000001','Payout Operation QA Customer');

insert into public.tailor_profiles (
  id,user_id,display_name,location,payout_currency,is_test_profile,is_live,is_verified
) values (
  '71000000-0000-4000-8000-000000000003',
  '71000000-0000-4000-8000-000000000002',
  'Payout Operation QA Tailor','Local test','NGN',true,false,false
);

insert into public.orders (
  id,reference,customer_id,tailor_profile_id,garment_type,description,
  fabric_source,delivery_method,stage,commercial_policy_version,subtotal_amount,
  tailor_payout_provider_locked,tailor_payout_currency_locked,
  tailor_stripe_connect_account_id_locked,handoff_completed_at,
  customer_handoff_confirmed_at
) values (
  '71000000-0000-4000-8000-000000000004',
  'PAYOUT-OP-QA-20261028-A',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000003',
  'QA garment','Rollback-only payout operation test','TAILOR_SOURCES','SHIPPING','COMPLETE',
  'legacy-single-release-72h',5000,'STRIPE','USD','acct_qa_provider',
  now()-interval '73 hours',now()-interval '73 hours'
),(
  '71000000-0000-4000-8000-000000000005',
  'PAYOUT-OP-QA-20261028-B',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000003',
  'QA garment','Rollback-only payout operation test','TAILOR_SOURCES','SHIPPING','COMPLETE',
  'legacy-single-release-72h',7000,'STRIPE','USD','acct_qa_provider',
  now()-interval '73 hours',now()-interval '73 hours'
);

insert into public.payout_claims (
  id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
  provider_destination_id,currency,amount,route_version,earning_policy_version,
  tailor_terms_version,provider_idempotency_key
) values
  ('71000000-0000-4000-8000-000000000010','qa:earning:71000000-0000-4000-8000-000000000010','ORDER_EARNING','71000000-0000-4000-8000-000000000004',
   '71000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000003','STRIPE','acct_qa_provider','USD',5000,
   'qa-route-v1','legacy-single-release-72h','qa-terms-v1','qa:earning:71000000-0000-4000-8000-000000000010'),
  ('71000000-0000-4000-8000-000000000011','qa:earning:71000000-0000-4000-8000-000000000011','ORDER_EARNING','71000000-0000-4000-8000-000000000005',
   '71000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000003','STRIPE','acct_qa_provider','USD',7000,
   'qa-route-v1','legacy-single-release-72h','qa-terms-v1','qa:earning:71000000-0000-4000-8000-000000000011');

do $test$
declare
  v_start jsonb;
  v_result jsonb;
  v_claim_one uuid := '71000000-0000-4000-8000-000000000010';
  v_claim_two uuid := '71000000-0000-4000-8000-000000000011';
  v_attempt_one uuid;
  v_attempt_two uuid;
  v_operation_one uuid;
  v_operation_two uuid;
begin
  v_start := public.start_payout_attempt(v_claim_one,'PROVIDER_CALL');
  if v_start->>'action' <> 'PROVIDER_CALL'
    or v_start->>'provider_idempotency_key' <> 'qa:earning:71000000-0000-4000-8000-000000000010'
    or v_start->>'provider_destination_id' <> 'acct_qa_provider'
    or v_start->>'provider' <> 'STRIPE'
    or v_start->>'currency' <> 'USD'
    or v_start->>'amount' <> '5000' then
    raise exception 'Provider call did not return the frozen operation identity: %', v_start;
  end if;
  v_attempt_one := (v_start->>'attempt_id')::uuid;
  v_operation_one := (v_start->>'claim_operation_id')::uuid;
  if not exists (select 1 from public.payout_attempts where id=v_attempt_one and claim_operation_id=v_operation_one)
    or not exists (select 1 from public.payout_provider_operations where id=v_operation_one and status='PROVIDER_UNKNOWN') then
    raise exception 'Provider call was not durably linked before network I/O';
  end if;

  v_result := public.record_payout_attempt_outcome(v_attempt_one,'SUCCEEDED','tr_qa_first',
    '{"source":"rollback-only-test","confirmed":true}'::jsonb);
  if v_result->>'outcome' <> 'RECORDED' or v_result->>'late_success' <> 'false' then
    raise exception 'Initial provider confirmation was not recorded: %', v_result;
  end if;
  if not exists (select 1 from public.payout_provider_operations
      where id=v_operation_one and status='TRANSFERRED' and provider_transfer_id='tr_qa_first')
    or not exists (select 1 from public.payout_attempts
      where id=v_attempt_one and 'tr_qa_first'=any(observed_provider_transfer_ids)) then
    raise exception 'Provider transfer ID was not durably recorded on operation and attempt';
  end if;

  v_result := public.record_payout_attempt_outcome(v_attempt_one,'SUCCEEDED','tr_qa_first',
    '{"source":"duplicate-replay","confirmed":true}'::jsonb);
  if v_result->>'outcome' <> 'EXISTING' then
    raise exception 'Same transfer replay did not resolve idempotently: %', v_result;
  end if;

  v_result := public.record_payout_attempt_outcome(v_attempt_one,'SUCCEEDED','tr_qa_duplicate',
    '{"source":"second-provider-transfer","confirmed":true}'::jsonb);
  if v_result->>'late_success' <> 'true' or v_result->>'status' <> 'BLOCKED' then
    raise exception 'A distinct late transfer did not block the claim and open Ops review: %', v_result;
  end if;
  if not exists (select 1 from public.payout_provider_operations
      where id=v_operation_one and status='LATE_SUCCEEDED' and provider_transfer_id='tr_qa_first')
    or not exists (select 1 from public.payout_attempts
      where id=v_attempt_one and 'tr_qa_duplicate'=any(observed_provider_transfer_ids))
    or not exists (select 1 from public.ops_issues
      where dedupe_key='payout-operation-late-success:'||v_operation_one::text and status='OPEN') then
    raise exception 'Late transfer conflict history or Ops case was not durably preserved';
  end if;

  begin
    update public.payout_provider_operations set status='RESERVED' where id=v_operation_one;
    raise exception 'Expected reverse payout transition to be rejected';
  exception when raise_exception then
    if sqlerrm not like 'Invalid provider payout operation transition:%' then raise; end if;
  end;

  v_start := public.start_payout_attempt(v_claim_two,'PROVIDER_CALL');
  v_attempt_two := (v_start->>'attempt_id')::uuid;
  v_operation_two := (v_start->>'claim_operation_id')::uuid;
  v_result := public.record_payout_attempt_outcome(v_attempt_two,'PROVIDER_PENDING','tr_qa_pending',
    '{"source":"provider-pending","status":"pending"}'::jsonb);
  if v_result->>'status' <> 'PROVIDER_PENDING'
    or not exists (select 1 from public.payout_provider_operations
      where id=v_operation_two and status='PROVIDER_PENDING' and provider_transfer_id='tr_qa_pending') then
    raise exception 'Pending provider state was not recorded';
  end if;
  v_result := public.record_payout_attempt_outcome(v_attempt_two,'PROVIDER_UNKNOWN',null,
    '{"source":"status-check-timeout"}'::jsonb);
  if v_result->>'status' <> 'PROVIDER_PENDING'
    or not exists (select 1 from public.payout_claims
      where id=v_claim_two and status='PROVIDER_PENDING' and transfer_status='PENDING') then
    raise exception 'A failed lookup downgraded the last known pending provider state';
  end if;
  v_result := public.record_payout_attempt_outcome(v_attempt_two,'FAILED_RECONCILED',null,
    '{"terminal_failure_confirmed":true,"funds_return_confirmed":true,"final_failure_reference":"failed-final-qa","funds_return_reference":"balance-return-qa"}'::jsonb);
  if v_result->>'status' <> 'FAILED_RECONCILED'
    or not exists (select 1 from public.payout_provider_operations
      where id=v_operation_two and status='FAILED_RETURNED'
        and final_failure_reference='failed-final-qa'
        and funds_return_reference='balance-return-qa'
        and funds_return_confirmed_at is not null) then
    raise exception 'Final failure and funds-return evidence was not frozen on the operation';
  end if;

  v_result := public.record_payout_attempt_outcome(v_attempt_two,'SUCCEEDED','tr_qa_pending',
    '{"source":"late-success","confirmed":true}'::jsonb);
  if v_result->>'late_success' <> 'true' or v_result->>'status' <> 'BLOCKED'
    or not exists (select 1 from public.payout_provider_operations
      where id=v_operation_two and status='LATE_SUCCEEDED' and provider_transfer_id='tr_qa_pending') then
    raise exception 'Late success after final returned failure was not preserved and blocked';
  end if;
end;
$test$;

rollback;
select 'payout_provider_operation_attempt_tracking: PASS' as result;
