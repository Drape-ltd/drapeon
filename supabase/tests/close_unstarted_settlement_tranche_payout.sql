DO $test$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT has_function_privilege('service_role',
      'public.close_unstarted_settlement_tranche_payout(uuid,text)', 'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.close_unstarted_settlement_tranche_payout(uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon',
      'public.close_unstarted_settlement_tranche_payout(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'pre-provider close RPC grants are not service-role-only';
  END IF;

  INSERT INTO public.orders (id, tailor_profile_id, accepted_route_snapshot_at)
  VALUES ('test-order-safe-close', 'test-tailor', now());
  INSERT INTO public.order_settlement_plans (
    id, order_id, source_payment_id, policy_version, currency, status
  ) VALUES (
    '00000000-0000-4000-8000-000000000101', 'test-order-safe-close',
    '00000000-0000-4000-8000-000000000102', 'test-policy', 'USD', 'ACTIVE'
  );
  INSERT INTO public.order_settlement_tranches (
    id, plan_id, order_id, code, amount, currency, status, payout_id
  ) VALUES (
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000101', 'test-order-safe-close', 'T1', 8400,
    'USD', 'RELEASE_REQUESTED', 'test-payout-safe-close'
  );
  INSERT INTO public.payouts (
    id, tailor_profile_id, amount, currency, provider, order_id, status,
    provider_response, settlement_tranche_id, provider_transfer_status,
    provider_destination_id, bank_settlement_status
  ) VALUES (
    'test-payout-safe-close', 'test-tailor', 8400, 'USD', 'STRIPE',
    'test-order-safe-close', 'PROCESSING', '{}',
    '00000000-0000-4000-8000-000000000103', 'PROCESSING', 'acct_test', 'PENDING'
  );
  INSERT INTO public.payout_claims (
    id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
    provider_destination_id,currency,amount,route_version,earning_policy_version,
    tailor_terms_version,provider_idempotency_key,status,transfer_status,
    payout_id,created_at,updated_at
  ) VALUES (
    '00000000-0000-4000-8000-000000000104','tranche:test-safe-close',
    'SETTLEMENT_TRANCHE','00000000-0000-4000-8000-000000000103',
    'test-order-safe-close','test-tailor','STRIPE','acct_test','USD',8400,
    'route-v1','test-policy','terms-v1','tranche:test-safe-close:op:1',
    'RESERVED','NOT_STARTED','test-payout-safe-close',now()-interval '1 hour',now()-interval '1 hour'
  );
  INSERT INTO public.payout_provider_operations (
    id,claim_id,operation_number,provider,provider_destination_id,currency,
    amount,provider_idempotency_key,status,created_at,updated_at
  ) VALUES (
    '00000000-0000-4000-8000-000000000105',
    '00000000-0000-4000-8000-000000000104',1,'STRIPE','acct_test','USD',8400,
    'tranche:test-safe-close:op:1','RESERVED',now()-interval '1 hour',now()-interval '1 hour'
  );

  v_result := public.close_unstarted_settlement_tranche_payout(
    '00000000-0000-4000-8000-000000000104','PRE_PROVIDER_ABORT'
  );
  IF v_result->>'outcome' <> 'ABORTED'
    OR (SELECT status::text FROM public.payouts WHERE id='test-payout-safe-close') <> 'FAILED'
    OR (SELECT status FROM public.payout_claims WHERE id='00000000-0000-4000-8000-000000000104') <> 'FAILED_RECONCILED'
    OR (SELECT transfer_status FROM public.payout_claims WHERE id='00000000-0000-4000-8000-000000000104') <> 'FAILED_RECONCILED'
    OR (SELECT status FROM public.payout_provider_operations WHERE id='00000000-0000-4000-8000-000000000105') <> 'FAILED_RETURNED'
    OR (SELECT funds_return_reference FROM public.payout_provider_operations WHERE id='00000000-0000-4000-8000-000000000105') <> 'NOT_SENT:LOCAL_PRE_PROVIDER_ABORT'
    OR (SELECT status FROM public.order_settlement_tranches WHERE id='00000000-0000-4000-8000-000000000103') <> 'BLOCKED'
    OR (SELECT blocked_reason FROM public.order_settlement_tranches WHERE id='00000000-0000-4000-8000-000000000103') <> 'PAYOUT_PRE_PROVIDER_ABORT'
    OR EXISTS (SELECT 1 FROM public.payout_attempts WHERE claim_id='00000000-0000-4000-8000-000000000104') THEN
    RAISE EXCEPTION 'safe no-attempt reservation did not close cleanly: %', v_result;
  END IF;
  IF public.close_unstarted_settlement_tranche_payout(
      '00000000-0000-4000-8000-000000000104','PRE_PROVIDER_ABORT')->>'outcome' <> 'ALREADY_CLOSED' THEN
    RAISE EXCEPTION 'replay did not remain idempotently closed';
  END IF;

  INSERT INTO public.orders (id, tailor_profile_id, accepted_route_snapshot_at)
  VALUES ('test-order-attempted', 'test-tailor', now());
  INSERT INTO public.order_settlement_tranches (
    id, plan_id, order_id, code, amount, currency, status, payout_id
  ) VALUES (
    '00000000-0000-4000-8000-000000000203',
    '00000000-0000-4000-8000-000000000101', 'test-order-attempted', 'T1', 8400,
    'USD', 'RELEASE_REQUESTED', 'test-payout-attempted'
  );
  INSERT INTO public.payouts (
    id, tailor_profile_id, amount, currency, provider, order_id, status,
    provider_response, settlement_tranche_id, provider_transfer_status,
    provider_destination_id, bank_settlement_status
  ) VALUES (
    'test-payout-attempted', 'test-tailor', 8400, 'USD', 'STRIPE',
    'test-order-attempted', 'PROCESSING', '{}',
    '00000000-0000-4000-8000-000000000203', 'PROCESSING', 'acct_test', 'PENDING'
  );
  INSERT INTO public.payout_claims (
    id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
    provider_destination_id,currency,amount,route_version,earning_policy_version,
    tailor_terms_version,provider_idempotency_key,status,transfer_status,
    payout_id,created_at,updated_at
  ) VALUES (
    '00000000-0000-4000-8000-000000000204','tranche:test-attempted',
    'SETTLEMENT_TRANCHE','00000000-0000-4000-8000-000000000203',
    'test-order-attempted','test-tailor','STRIPE','acct_test','USD',8400,
    'route-v1','test-policy','terms-v1','tranche:test-attempted:op:1',
    'RESERVED','NOT_STARTED','test-payout-attempted',now()-interval '1 hour',now()-interval '1 hour'
  );
  INSERT INTO public.payout_provider_operations (
    id,claim_id,operation_number,provider,provider_destination_id,currency,
    amount,provider_idempotency_key,status,created_at,updated_at
  ) VALUES (
    '00000000-0000-4000-8000-000000000205',
    '00000000-0000-4000-8000-000000000204',1,'STRIPE','acct_test','USD',8400,
    'tranche:test-attempted:op:1','RESERVED',now()-interval '1 hour',now()-interval '1 hour'
  );
  INSERT INTO public.payout_attempts (id,claim_id,attempt_number,status)
  VALUES ('00000000-0000-4000-8000-000000000206',
    '00000000-0000-4000-8000-000000000204',1,'PREPARED');
  v_result := public.close_unstarted_settlement_tranche_payout(
    '00000000-0000-4000-8000-000000000204','PRE_PROVIDER_ABORT'
  );
  IF v_result->>'outcome' <> 'NOT_SAFE'
    OR (SELECT status::text FROM public.payouts WHERE id='test-payout-attempted') <> 'PROCESSING'
    OR (SELECT status FROM public.payout_claims WHERE id='00000000-0000-4000-8000-000000000204') <> 'RESERVED'
    OR (SELECT status FROM public.order_settlement_tranches WHERE id='00000000-0000-4000-8000-000000000203') <> 'RELEASE_REQUESTED' THEN
    RAISE EXCEPTION 'existing provider attempt was changed by the abort RPC: %', v_result;
  END IF;
END;
$test$;

SELECT 'PASS terminal no-provider close, idempotent replay, and attempt-present fail-closed check';
