-- Close only a reservation that provably never crossed the provider-attempt gate.
-- start_payout_attempt creates the attempt and changes claim/operation state in
-- one transaction before the Stripe adapter can make a network call.
-- A pre-provider close may bind the original Stripe charge to the operation so
-- the reviewed same-destination retry has the same source_transaction evidence.
CREATE OR REPLACE FUNCTION public.prevent_payout_provider_operation_identity_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_transition_allowed boolean := false;
  v_source_bind boolean := false;
  v_pre_provider_source_bind boolean := false;
begin
  v_pre_provider_source_bind := old.provider_source_transaction_id is null
    and new.provider_source_transaction_id ~ '^ch_[A-Za-z0-9_-]+$'
    and old.provider = 'STRIPE'
    and old.status = 'RESERVED'
    and new.status = 'RESERVED'
    and current_setting('app.bind_payout_source_transaction', true) = 'on'
    and exists (
      select 1
      from public.payout_claims c
      join public.payouts p on p.id::text=c.payout_id
      join public.order_payments payment on payment.id=p.source_payment_id
      where c.id=old.claim_id and c.status='RESERVED'
        and c.transfer_status='NOT_STARTED' and c.provider_transfer_id is null
        and c.source_kind='SETTLEMENT_TRANCHE' and c.provider='STRIPE'
        and p.provider='STRIPE' and p.status='PROCESSING'
        and payment.provider='STRIPE'
        and payment.status in ('SUCCEEDED','PARTIAL_REFUND')
        and payment.order_id::text=c.order_id
        and (
          payment.provider_charge_id=new.provider_source_transaction_id
          or exists (
            select 1
            from lateral (values
              (payment.provider_response->'latest_charge'),
              (payment.provider_response->'charge'),
              (payment.provider_response->'payment_intent'->'latest_charge'),
              (payment.provider_response->'data'->'object'->'latest_charge'),
              (payment.provider_response->'data'->'object'->'charge')
            ) as candidates(value)
            where case jsonb_typeof(candidates.value)
              when 'string' then candidates.value #>> '{}'
              when 'object' then candidates.value->>'id'
              else null
            end = new.provider_source_transaction_id
          )
        )
        and not exists (select 1 from public.payout_attempts a
          where a.claim_operation_id=old.id or a.claim_id=c.id)
    );
  v_source_bind := (old.provider_source_transaction_id is null
    and new.provider_source_transaction_id ~ '^ch_[A-Za-z0-9_-]+$'
    and old.provider = 'STRIPE'
    and old.status = 'PROVIDER_UNKNOWN'
    and current_setting('app.bind_payout_source_transaction', true) = 'on')
    or v_pre_provider_source_bind;

  if row(new.claim_id, new.operation_number, new.provider, new.provider_destination_id,
         new.currency, new.amount, new.provider_idempotency_key, new.reviewed_correction_id,
         new.reviewed_retry_id, new.money_desk_request_id)
    is distinct from
     row(old.claim_id, old.operation_number, old.provider, old.provider_destination_id,
         old.currency, old.amount, old.provider_idempotency_key, old.reviewed_correction_id,
         old.reviewed_retry_id, old.money_desk_request_id)
    or (new.provider_source_transaction_id is distinct from old.provider_source_transaction_id
      and not v_source_bind) then
    raise exception 'Provider operation identity cannot change';
  end if;

  if new.status = old.status then
    v_transition_allowed := true;
  else
    v_transition_allowed := case old.status
      when 'RESERVED' then new.status in ('PROVIDER_UNKNOWN','PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED')
      when 'PROVIDER_UNKNOWN' then new.status in ('PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED','LATE_SUCCEEDED')
      when 'PROVIDER_PENDING' then new.status in ('PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED','LATE_SUCCEEDED')
      when 'TRANSFERRED' then new.status in ('WITHDRAWN','LATE_SUCCEEDED')
      when 'WITHDRAWN' then new.status = 'LATE_SUCCEEDED'
      when 'FAILED_RETURNED' then new.status = 'LATE_SUCCEEDED'
      when 'LATE_SUCCEEDED' then false
      else false
    end;
  end if;
  if not v_transition_allowed then
    raise exception 'Invalid provider payout operation transition: % -> %', old.status, new.status;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

DROP FUNCTION IF EXISTS public.close_unstarted_settlement_tranche_payout(uuid, text);

CREATE FUNCTION public.close_unstarted_settlement_tranche_payout(
  p_claim_id uuid,
  p_failure_code text,
  p_source_transaction text
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
  v_source_charge text;
  v_payment_charge text;
  v_provider_response jsonb;
  v_source_bind_rows integer := 0;
  v_retry_available boolean := false;
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
  PERFORM 1 FROM public.orders WHERE id::text = v_order_id FOR UPDATE;
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
                              'tranche_id', v_tranche.id,
                              'retry_available', v_claim.provider = 'STRIPE'
                                AND v_operation.provider_source_transaction_id ~ '^ch_[A-Za-z0-9_-]+$');
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

  -- Bind only the source charge resolved by the release function, and only
  -- after it matches evidence on the payout's pinned payment. Some imported
  -- Stripe payments store latest_charge only in provider_response.
  IF v_claim.provider = 'STRIPE' AND v_payout.source_payment_id IS NOT NULL THEN
    SELECT provider_charge_id, provider_response
      INTO v_payment_charge, v_provider_response
    FROM public.order_payments
    WHERE id = v_payout.source_payment_id
      AND order_id::text = v_claim.order_id
      AND provider = 'STRIPE'
      AND status IN ('SUCCEEDED', 'PARTIAL_REFUND');
    IF p_source_transaction ~ '^ch_[A-Za-z0-9_-]+$'
      AND (
        v_payment_charge = p_source_transaction
        OR EXISTS (
          SELECT 1
          FROM LATERAL (VALUES
            (v_provider_response->'latest_charge'),
            (v_provider_response->'charge'),
            (v_provider_response->'payment_intent'->'latest_charge'),
            (v_provider_response->'data'->'object'->'latest_charge'),
            (v_provider_response->'data'->'object'->'charge')
          ) AS candidates(value)
          WHERE CASE jsonb_typeof(candidates.value)
            WHEN 'string' THEN candidates.value #>> '{}'
            WHEN 'object' THEN candidates.value->>'id'
            ELSE NULL
          END = p_source_transaction
        )
      ) THEN
      v_source_charge := p_source_transaction;
      PERFORM set_config('app.bind_payout_source_transaction', 'on', true);
      UPDATE public.payout_provider_operations
      SET provider_source_transaction_id = v_source_charge
      WHERE id = v_operation.id
        AND status = 'RESERVED'
        AND provider_source_transaction_id IS NULL;
      GET DIAGNOSTICS v_source_bind_rows = ROW_COUNT;
      PERFORM set_config('app.bind_payout_source_transaction', '', true);
      IF v_source_bind_rows <> 1 THEN
        RAISE EXCEPTION 'Could not bind pinned Stripe source charge for reviewed retry';
      END IF;
      v_retry_available := true;
      SELECT * INTO v_operation FROM public.payout_provider_operations
      WHERE id = v_operation.id;
    END IF;
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

  -- The claim trigger treats every FAILED_RECONCILED tranche as returned funds.
  -- Replace that case in this same transaction: this abort happened before
  -- Stripe was called, so no returned balance or destination correction exists.
  UPDATE public.ops_issues SET
    status = 'OPEN', canonical_status = 'NEW', resolved_at = NULL, closed_at = NULL,
    last_seen_at = now(), source = 'payout-pre-provider-abort',
    title = 'Payout stopped before reaching Stripe',
    description = 'The payout reservation failed before any provider attempt was created. No transfer was sent and no money left Drapeon.',
    recommended_action = CASE WHEN v_retry_available
      THEN 'Resolve the pre-provider failure, then use the reviewed same-destination payout retry. Do not send a manual transfer.'
      WHEN v_claim.provider = 'STRIPE'
        THEN 'A reviewed Stripe retry is unavailable until Ops verifies the original source charge against the payment record. Do not send a manual transfer.'
      ELSE 'No reviewed retry path is available for this provider. Ops must reconcile the route before any new payout action. Do not send a manual transfer.'
      END,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'claim_id', v_claim.id, 'payout_id', v_claim.payout_id,
      'operation_id', v_operation.id, 'failure_code', p_failure_code,
      'terminal_outcome', 'NO_PROVIDER_ATTEMPT',
      'retry_available', v_retry_available)
  WHERE dedupe_key = lower(v_claim.provider) || '-tranche-reconcile:' || v_claim.source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pre-provider close did not create its tranche Ops case';
  END IF;

  RETURN jsonb_build_object('outcome', 'ABORTED', 'claim_id', v_claim.id,
                            'payout_id', v_claim.payout_id,
                            'tranche_id', v_tranche.id,
                            'retry_available', v_retry_available);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_unstarted_settlement_tranche_payout(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_unstarted_settlement_tranche_payout(uuid, text, text)
  TO service_role;
