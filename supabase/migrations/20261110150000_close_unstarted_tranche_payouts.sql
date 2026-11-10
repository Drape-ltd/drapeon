-- Close only a reservation that provably never crossed the provider-attempt gate.
-- start_payout_attempt creates the attempt and changes claim/operation state in
-- one transaction before the Stripe adapter can make a network call.
CREATE OR REPLACE FUNCTION public.close_unstarted_settlement_tranche_payout(
  p_claim_id uuid,
  p_failure_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_claim public.payout_claims%rowtype;
  v_order_id text;
  v_tranche public.order_settlement_tranches%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_payout public.payouts%rowtype;
BEGIN
  IF p_failure_code NOT IN (
    'PRE_PROVIDER_ABORT',
    'STRIPE_SOURCE_CHARGE_MISSING',
    'PAYOUT_RELEASE_PINNED_DESTINATION_MISSING',
    'PAYOUT_RELEASE_PINNED_DESTINATION_MISMATCH',
    'PAYOUT_RELEASE_STRIPE_REFRESH_NETWORK_ERROR',
    'PAYOUT_RELEASE_STRIPE_REFRESH_FAILED',
    'PAYOUT_RELEASE_DESTINATION_READ_FAILED',
    'PAYOUT_RELEASE_STRIPE_REFRESH_STALE',
    'PAYOUT_RELEASE_STRIPE_CAPABILITY_DISABLED',
    'PAYOUT_RELEASE_REFRESH_EVIDENCE_NOT_RECORDED',
    'PAYOUT_RELEASE_ORDER_READ_FAILED',
    'PAYOUT_RELEASE_STRIPE_SNAPSHOT_MISSING'
  ) THEN
    RAISE EXCEPTION 'Unrecognized pre-provider failure code';
  END IF;

  SELECT order_id INTO v_order_id
  FROM public.payout_claims
  WHERE id = p_claim_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'NOT_SAFE');
  END IF;

  -- Match the release reservation lock order: order, tranche, claim, payout.
  PERFORM 1 FROM public.orders WHERE id = v_order_id FOR UPDATE;
  SELECT * INTO v_tranche
  FROM public.order_settlement_tranches
  WHERE order_id = v_order_id
    AND id::text = (SELECT source_id FROM public.payout_claims WHERE id = p_claim_id)
  FOR UPDATE;
  SELECT * INTO v_claim FROM public.payout_claims WHERE id = p_claim_id FOR UPDATE;
  SELECT * INTO v_operation
  FROM public.payout_provider_operations
  WHERE claim_id = v_claim.id AND operation_number = 1
  FOR UPDATE;
  IF v_claim.status = 'FAILED_RECONCILED'
    AND v_claim.transfer_status = 'FAILED_RECONCILED'
    AND v_claim.source_kind = 'SETTLEMENT_TRANCHE'
    AND v_operation.status = 'FAILED_RETURNED'
    AND v_operation.final_failure_reference = 'LOCAL_PRE_PROVIDER_ABORT'
    AND v_tranche.status = 'BLOCKED'
    AND v_tranche.blocked_reason = 'PAYOUT_PRE_PROVIDER_ABORT'
    AND v_operation.funds_return_reference = 'NOT_SENT:LOCAL_PRE_PROVIDER_ABORT'
    AND v_operation.funds_return_confirmed_at IS NOT NULL
  THEN
    RETURN jsonb_build_object('outcome', 'ALREADY_CLOSED', 'claim_id', v_claim.id,
                              'payout_id', v_claim.payout_id,
                              'tranche_id', v_tranche.id);
  END IF;

  SELECT * INTO v_payout FROM public.payouts WHERE id::text = v_claim.payout_id FOR UPDATE;

  IF v_claim.source_kind <> 'SETTLEMENT_TRANCHE'
    OR v_claim.status <> 'RESERVED'
    OR v_claim.transfer_status <> 'NOT_STARTED'
    OR v_claim.provider_transfer_id IS NOT NULL
    OR v_claim.payout_id IS NULL
    OR v_tranche.id IS NULL
    OR v_tranche.status <> 'RELEASE_REQUESTED'
    OR v_tranche.payout_id IS DISTINCT FROM v_claim.payout_id
    OR v_tranche.release_ledger_transaction_id IS NOT NULL
    OR v_claim.payout_ledger_transaction_id IS NOT NULL
    OR v_operation.id IS NULL
    OR v_operation.status <> 'RESERVED'
    OR v_operation.provider_transfer_id IS NOT NULL
    OR v_operation.final_failure_reference IS NOT NULL
    OR v_payout.id IS NULL
    OR v_payout.status <> 'PROCESSING'
    OR v_payout.provider_transfer_status <> 'PROCESSING'
    OR v_payout.provider_payout_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.payout_attempts WHERE claim_id = v_claim.id)
    OR EXISTS (
      SELECT 1 FROM public.commercial_ledger_transactions
      WHERE purpose = 'SETTLEMENT_RELEASE'
        AND metadata->>'tranche_id' = v_tranche.id::text
    )
  THEN
    RETURN jsonb_build_object('outcome', 'NOT_SAFE', 'claim_id', v_claim.id);
  END IF;

  UPDATE public.payout_provider_operations
  SET status = 'FAILED_RETURNED',
      final_failure_reference = 'LOCAL_PRE_PROVIDER_ABORT',
      funds_return_reference = 'NOT_SENT:LOCAL_PRE_PROVIDER_ABORT',
      funds_return_confirmed_at = now()
  WHERE id = v_operation.id AND status = 'RESERVED';

  UPDATE public.payout_claims
  SET status = 'FAILED_RECONCILED', transfer_status = 'FAILED_RECONCILED', updated_at = now(),
      last_provider_checked_at = now()
  WHERE id = v_claim.id;

  UPDATE public.payouts
  SET status = 'FAILED', provider_transfer_status = 'FAILED',
      bank_settlement_status = 'BLOCKED', blocked_reason = 'PAYOUT_PRE_PROVIDER_ABORT',
      failed_at = now(), provider_response = coalesce(provider_response, '{}'::jsonb)
        || jsonb_build_object('terminal_outcome', 'NO_PROVIDER_ATTEMPT',
                              'failure_code', p_failure_code,
                              'claim_id', v_claim.id,
                              'claim_operation_id', v_operation.id)
  WHERE id::text = v_claim.payout_id;

  UPDATE public.order_settlement_tranches
  SET status = 'BLOCKED', blocked_reason = 'PAYOUT_PRE_PROVIDER_ABORT', updated_at = now()
  WHERE id = v_tranche.id;

  RETURN jsonb_build_object('outcome', 'ABORTED', 'claim_id', v_claim.id,
                            'payout_id', v_claim.payout_id,
                            'tranche_id', v_tranche.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_unstarted_settlement_tranche_payout(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_unstarted_settlement_tranche_payout(uuid, text)
  TO service_role;
