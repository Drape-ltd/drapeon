-- Rollback-only behavioral proof. This intentionally fails on main because a
-- definitely rejected, not-sent Stripe claim has no reviewed retry path.
begin;

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('72000000-0000-4000-8000-000000000001','authenticated','authenticated',
   'retry-customer@example.invalid','',now(),'{}','{}',now(),now()),
  ('72000000-0000-4000-8000-000000000002','authenticated','authenticated',
   'retry-tailor@example.invalid','',now(),'{}','{}',now(),now());

insert into public.customer_profiles(user_id,display_name)
values('72000000-0000-4000-8000-000000000001','Reviewed Retry QA Customer');
insert into public.tailor_profiles(
  id,user_id,display_name,location,payout_currency,is_test_profile,is_live,is_verified
) values (
  '72000000-0000-4000-8000-000000000003',
  '72000000-0000-4000-8000-000000000002',
  'Reviewed Retry QA Tailor','Local test','NGN',true,false,false
);
insert into public.orders(
  id,reference,customer_id,tailor_profile_id,garment_type,description,
  fabric_source,delivery_method,stage,commercial_policy_version,subtotal_amount,
  tailor_payout_provider_locked,tailor_payout_currency_locked,
  tailor_stripe_connect_account_id_locked,handoff_completed_at,
  customer_handoff_confirmed_at
) values (
  '72000000-0000-4000-8000-000000000004','PAYOUT-RETRY-QA-20261110',
  '72000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000003',
  'QA garment','Rollback-only reviewed retry test','TAILOR_SOURCES','SHIPPING',
  'COMPLETE','legacy-single-release-72h',8400,'STRIPE','USD',
  'acct_qa_same_destination',now()-interval '73 hours',now()-interval '73 hours'
);
insert into public.payout_claims(
  id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
  provider_destination_id,currency,amount,route_version,earning_policy_version,
  tailor_terms_version,provider_idempotency_key
) values (
  '72000000-0000-4000-8000-000000000010',
  'qa:earning:72000000-0000-4000-8000-000000000010','ORDER_EARNING',
  '72000000-0000-4000-8000-000000000004',
  '72000000-0000-4000-8000-000000000004',
  '72000000-0000-4000-8000-000000000003','STRIPE',
  'acct_qa_same_destination','USD',8400,'qa-route-v1',
  'legacy-single-release-72h','qa-terms-v1',
  'qa:earning:72000000-0000-4000-8000-000000000010'
);

do $test$
declare
  v_claim uuid := '72000000-0000-4000-8000-000000000010';
  v_request uuid := '72000000-0000-4000-8000-000000000020';
  v_start jsonb;
  v_result jsonb;
  v_operation uuid;
begin
  v_start := public.start_payout_attempt(v_claim,'PROVIDER_CALL');
  v_operation := (v_start->>'claim_operation_id')::uuid;
  v_result := public.record_payout_attempt_outcome(
    (v_start->>'attempt_id')::uuid,'FAILED_RECONCILED',null,
    '{"terminal_failure_confirmed":true,"funds_return_confirmed":true,
      "final_failure_reference":"req_qa_definite_rejection",
      "funds_return_reference":"NOT_SENT:transfers_not_enabled"}'::jsonb
  );
  if v_result->>'status' <> 'FAILED_RECONCILED' or not exists (
    select 1 from public.payout_provider_operations
    where id=v_operation and status='FAILED_RETURNED'
      and funds_return_reference='NOT_SENT:transfers_not_enabled'
      and provider_transfer_id is null
  ) then raise exception 'Fixture did not close the not-sent operation'; end if;
  if (public.start_payout_attempt(v_claim,'PROVIDER_CALL')->>'action') <> 'BLOCKED' then
    raise exception 'Main baseline unexpectedly has an unreviewed retry path';
  end if;

  insert into public.money_desk_requests(
    id,action_type,target_type,target_id,order_id,amount,currency,status,
    requester_email,reason,approval_count,required_approval_count,approved_at
  ) values (
    v_request,'POST_RELEASE_RECOVERY','PAYOUT_CLAIM_RETRY',v_claim::text,
    '72000000-0000-4000-8000-000000000004',8400,'USD','EXECUTING',
    'preparer@example.invalid','Retry only after exact no-transfer evidence',2,2,now()
  );
  insert into public.money_desk_decisions(request_id,decision,approver_email)
  values(v_request,'APPROVE','approver1@example.invalid'),
        (v_request,'APPROVE','approver2@example.invalid');
  insert into public.money_desk_execution_attempts(request_id,status)
  values(v_request,'PROCESSING');

  v_result := public.apply_reviewed_claimed_payout_retry(
    v_request,'executor@example.invalid','ADMIN'
  );
  if v_result->>'outcome' <> 'RETRY_READY'
    or (v_result->>'operationNumber')::integer <> 2
    or v_result->>'claimId' <> v_claim::text then
    raise exception 'Reviewed same-destination operation 2 was not prepared: %',v_result;
  end if;
  if (public.start_payout_attempt(v_claim,'PROVIDER_CALL')->>'action') <> 'PROVIDER_CALL' then
    raise exception 'Reviewed retry did not reach the normal claimed payout path';
  end if;
  raise notice 'PASS reviewed claimed payout retry: not-sent operation 1, independent review, operation 2';
end;
$test$;

rollback;
