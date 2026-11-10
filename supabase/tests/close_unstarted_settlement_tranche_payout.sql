DO $test$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT has_function_privilege('service_role',
      'public.close_unstarted_settlement_tranche_payout(uuid,text,text)', 'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.close_unstarted_settlement_tranche_payout(uuid,text,text)', 'EXECUTE')
    OR has_function_privilege('anon',
      'public.close_unstarted_settlement_tranche_payout(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'pre-provider close RPC grants are not service-role-only';
  END IF;

  INSERT INTO public.orders (id, tailor_profile_id, accepted_route_snapshot_at)
  VALUES ('test-order-safe-close', 'test-tailor', now());
  INSERT INTO public.order_payments (
    id, order_id, phase, provider, currency, amount, status, provider_charge_id
  ) VALUES (
    '00000000-0000-4000-8000-000000000102', 'test-order-safe-close',
    'INITIAL_ORDER', 'STRIPE', 'USD', 13531, 'SUCCEEDED', NULL
  );
  UPDATE public.order_payments
  SET provider_response = '{"latest_charge":"ch_test_original_charge"}'::jsonb
  WHERE id='00000000-0000-4000-8000-000000000102';
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
    provider_destination_id, bank_settlement_status, source_payment_id, id_text
  ) VALUES (
    'test-payout-safe-close', 'test-tailor', 8400, 'USD', 'STRIPE',
    'test-order-safe-close', 'PROCESSING', '{}',
    '00000000-0000-4000-8000-000000000103', 'PROCESSING', 'acct_test', 'PENDING',
    '00000000-0000-4000-8000-000000000102', 'test-payout-safe-close'
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
    '00000000-0000-4000-8000-000000000104','PRE_PROVIDER_ABORT',
    'ch_test_original_charge'
  );
  IF v_result->>'outcome' <> 'ABORTED'
    OR v_result->>'retry_available' <> 'true'
    OR (SELECT status::text FROM public.payouts WHERE id='test-payout-safe-close') <> 'FAILED'
    OR (SELECT status FROM public.payout_claims WHERE id='00000000-0000-4000-8000-000000000104') <> 'FAILED_RECONCILED'
    OR (SELECT transfer_status FROM public.payout_claims WHERE id='00000000-0000-4000-8000-000000000104') <> 'FAILED_RECONCILED'
    OR (SELECT status FROM public.payout_provider_operations WHERE id='00000000-0000-4000-8000-000000000105') <> 'FAILED_RETURNED'
    OR (SELECT funds_return_reference FROM public.payout_provider_operations WHERE id='00000000-0000-4000-8000-000000000105') <> 'NOT_SENT:LOCAL_PRE_PROVIDER_ABORT'
    OR (SELECT status FROM public.order_settlement_tranches WHERE id='00000000-0000-4000-8000-000000000103') <> 'BLOCKED'
    OR (SELECT blocked_reason FROM public.order_settlement_tranches WHERE id='00000000-0000-4000-8000-000000000103') <> 'PAYOUT_PRE_PROVIDER_ABORT'
    OR (SELECT provider_source_transaction_id FROM public.payout_provider_operations WHERE id='00000000-0000-4000-8000-000000000105') <> 'ch_test_original_charge'
    OR EXISTS (SELECT 1 FROM public.payout_attempts WHERE claim_id='00000000-0000-4000-8000-000000000104') THEN
    RAISE EXCEPTION 'safe no-attempt reservation did not close cleanly: %', v_result;
  END IF;
  IF (SELECT count(*) FROM public.ops_issues
      WHERE dedupe_key='stripe-tranche-reconcile:00000000-0000-4000-8000-000000000103') <> 1
    OR (SELECT title FROM public.ops_issues
      WHERE dedupe_key='stripe-tranche-reconcile:00000000-0000-4000-8000-000000000103')
        <> 'Payout stopped before reaching Stripe'
    OR (SELECT description FROM public.ops_issues
      WHERE dedupe_key='stripe-tranche-reconcile:00000000-0000-4000-8000-000000000103')
        NOT LIKE '%No transfer was sent and no money left Drapeon%' THEN
    RAISE EXCEPTION 'claim trigger case was not corrected to the pre-provider outcome';
  END IF;
  IF (SELECT recommended_action FROM public.ops_issues
      WHERE dedupe_key='stripe-tranche-reconcile:00000000-0000-4000-8000-000000000103')
      NOT LIKE '%reviewed same-destination payout retry%' THEN
    RAISE EXCEPTION 'verified latest_charge was not presented as retryable';
  END IF;
  v_result := public.close_unstarted_settlement_tranche_payout(
    '00000000-0000-4000-8000-000000000104','PRE_PROVIDER_ABORT',
    'ch_test_original_charge');
  IF v_result->>'outcome' <> 'ALREADY_CLOSED'
    OR v_result->>'retry_available' <> 'true' THEN
    RAISE EXCEPTION 'replay did not remain idempotently closed';
  END IF;

  -- A close with no source charge is still safe, but the Ops case must not
  -- promise a retry until a verified source charge is available.
  UPDATE public.order_payments SET provider_response = '{}'::jsonb
  WHERE id='00000000-0000-4000-8000-000000000102';
  INSERT INTO public.order_settlement_tranches (
    id, plan_id, order_id, code, amount, currency, status, payout_id
  ) VALUES (
    '00000000-0000-4000-8000-000000000107',
    '00000000-0000-4000-8000-000000000101', 'test-order-safe-close', 'T2', 2400,
    'USD', 'RELEASE_REQUESTED', 'test-payout-no-source'
  );
  INSERT INTO public.payouts (
    id, tailor_profile_id, amount, currency, provider, order_id, status,
    provider_response, settlement_tranche_id, provider_transfer_status,
    provider_destination_id, bank_settlement_status, source_payment_id, id_text
  ) VALUES (
    'test-payout-no-source', 'test-tailor', 2400, 'USD', 'STRIPE',
    'test-order-safe-close', 'PROCESSING', '{}',
    '00000000-0000-4000-8000-000000000107', 'PROCESSING', 'acct_test', 'PENDING',
    '00000000-0000-4000-8000-000000000102', 'test-payout-no-source'
  );
  INSERT INTO public.payout_claims (
    id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
    provider_destination_id,currency,amount,route_version,earning_policy_version,
    tailor_terms_version,provider_idempotency_key,status,transfer_status,
    payout_id,created_at,updated_at
  ) VALUES (
    '00000000-0000-4000-8000-000000000108','tranche:test-no-source',
    'SETTLEMENT_TRANCHE','00000000-0000-4000-8000-000000000107',
    'test-order-safe-close','test-tailor','STRIPE','acct_test','USD',2400,
    'route-v1','test-policy','terms-v1','tranche:test-no-source:op:1',
    'RESERVED','NOT_STARTED','test-payout-no-source',now()-interval '1 hour',now()-interval '1 hour'
  );
  INSERT INTO public.payout_provider_operations (
    id,claim_id,operation_number,provider,provider_destination_id,currency,
    amount,provider_idempotency_key,status,created_at,updated_at
  ) VALUES (
    '00000000-0000-4000-8000-000000000109',
    '00000000-0000-4000-8000-000000000108',1,'STRIPE','acct_test','USD',2400,
    'tranche:test-no-source:op:1','RESERVED',now()-interval '1 hour',now()-interval '1 hour'
  );
  v_result := public.close_unstarted_settlement_tranche_payout(
    '00000000-0000-4000-8000-000000000108','PRE_PROVIDER_ABORT',NULL
  );
  IF v_result->>'outcome' <> 'ABORTED'
    OR v_result->>'retry_available' <> 'false'
    OR (SELECT provider_source_transaction_id FROM public.payout_provider_operations
        WHERE id='00000000-0000-4000-8000-000000000109') IS NOT NULL
    OR (SELECT recommended_action FROM public.ops_issues
        WHERE dedupe_key='stripe-tranche-reconcile:00000000-0000-4000-8000-000000000107')
        NOT LIKE '%retry is unavailable%' THEN
    RAISE EXCEPTION 'missing source charge incorrectly promised retry: %', v_result;
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
    '00000000-0000-4000-8000-000000000204','PRE_PROVIDER_ABORT',
    'ch_test_original_charge'
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
