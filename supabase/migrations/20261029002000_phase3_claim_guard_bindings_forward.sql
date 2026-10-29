-- Forward-only attachment of the 33 missing Phase 1 claim guards.
-- Each binding is compared with Dev's final definition. Existing bindings
-- with different definitions fail rather than being silently overwritten.
-- Apply only after the three guard-function restorations above.

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.order_payment_refund_claims'::regclass
    AND t.tgname='a0_refund_claim_replacement_race_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER a0_refund_claim_replacement_race_guard BEFORE INSERT ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION guard_new_refund_against_claimed_replacement()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER a0_refund_claim_replacement_race_guard BEFORE INSERT ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION guard_new_refund_against_claimed_replacement()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.order_payment_refund_claims.a0_refund_claim_replacement_race_guard';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.order_payment_refund_claims'::regclass
    AND t.tgname='case_late_order_refund_claim_success' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER case_late_order_refund_claim_success AFTER UPDATE OF status ON public.order_payment_refund_claims FOR EACH ROW WHEN (((old.status = 'FAILED_RECONCILED'::text) AND (new.status = 'SUCCEEDED'::text))) EXECUTE FUNCTION case_late_order_refund_claim_success()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER case_late_order_refund_claim_success AFTER UPDATE OF status ON public.order_payment_refund_claims FOR EACH ROW WHEN (((old.status = 'FAILED_RECONCILED'::text) AND (new.status = 'SUCCEEDED'::text))) EXECUTE FUNCTION case_late_order_refund_claim_success()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.order_payment_refund_claims.case_late_order_refund_claim_success';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.order_payment_refund_claims'::regclass
    AND t.tgname='guard_drapeon_funded_adjustment_refund_snapshot' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER guard_drapeon_funded_adjustment_refund_snapshot BEFORE UPDATE OF refund_context ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION guard_drapeon_funded_adjustment_refund_snapshot()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER guard_drapeon_funded_adjustment_refund_snapshot BEFORE UPDATE OF refund_context ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION guard_drapeon_funded_adjustment_refund_snapshot()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.order_payment_refund_claims.guard_drapeon_funded_adjustment_refund_snapshot';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.order_payment_refund_claims'::regclass
    AND t.tgname='guard_reviewed_adjustment_refund_claim' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER guard_reviewed_adjustment_refund_claim BEFORE INSERT ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION guard_reviewed_adjustment_refund_claim()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER guard_reviewed_adjustment_refund_claim BEFORE INSERT ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION guard_reviewed_adjustment_refund_claim()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.order_payment_refund_claims.guard_reviewed_adjustment_refund_claim';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.order_payment_refund_claims'::regclass
    AND t.tgname='order_payment_refund_context_immutable' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER order_payment_refund_context_immutable BEFORE UPDATE ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION guard_order_payment_refund_context()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER order_payment_refund_context_immutable BEFORE UPDATE ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION guard_order_payment_refund_context()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.order_payment_refund_claims.order_payment_refund_context_immutable';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.order_payment_refund_claims'::regclass
    AND t.tgname='order_payment_refund_ledger_snapshot_valid' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER order_payment_refund_ledger_snapshot_valid BEFORE UPDATE OF refund_context ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION validate_order_payment_refund_ledger_snapshot()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER order_payment_refund_ledger_snapshot_valid BEFORE UPDATE OF refund_context ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION validate_order_payment_refund_ledger_snapshot()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.order_payment_refund_claims.order_payment_refund_ledger_snapshot_valid';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.order_payment_refund_claims'::regclass
    AND t.tgname='order_refund_claim_confirm_order_work' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER order_refund_claim_confirm_order_work AFTER UPDATE OF status, provider_refund_id ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.confirm_order_work_refund_from_claim()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER order_refund_claim_confirm_order_work AFTER UPDATE OF status, provider_refund_id ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.confirm_order_work_refund_from_claim()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.order_payment_refund_claims.order_refund_claim_confirm_order_work';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.order_payment_refund_claims'::regclass
    AND t.tgname='order_refund_claim_require_staged_work_before_provider' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER order_refund_claim_require_staged_work_before_provider BEFORE UPDATE OF status ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.require_refund_work_before_provider()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER order_refund_claim_require_staged_work_before_provider BEFORE UPDATE OF status ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.require_refund_work_before_provider()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.order_payment_refund_claims.order_refund_claim_require_staged_work_before_provider';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.order_payment_refund_claims'::regclass
    AND t.tgname='order_refund_context_reserve_staged_work' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER order_refund_context_reserve_staged_work AFTER UPDATE OF refund_context ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.reserve_staged_work_for_refund()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER order_refund_context_reserve_staged_work AFTER UPDATE OF refund_context ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.reserve_staged_work_for_refund()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.order_payment_refund_claims.order_refund_context_reserve_staged_work';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.order_payment_refund_claims'::regclass
    AND t.tgname='sync_adjustment_refund_provider_outcome' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER sync_adjustment_refund_provider_outcome AFTER UPDATE OF status, provider_refund_id ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION sync_adjustment_refund_provider_outcome()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER sync_adjustment_refund_provider_outcome AFTER UPDATE OF status, provider_refund_id ON public.order_payment_refund_claims FOR EACH ROW EXECUTE FUNCTION sync_adjustment_refund_provider_outcome()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.order_payment_refund_claims.sync_adjustment_refund_provider_outcome';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_attempts'::regclass
    AND t.tgname='payout_attempt_replacement_identity_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_attempt_replacement_identity_guard BEFORE INSERT OR UPDATE ON public.payout_attempts FOR EACH ROW EXECUTE FUNCTION verify_replacement_attempt_identity()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_attempt_replacement_identity_guard BEFORE INSERT OR UPDATE ON public.payout_attempts FOR EACH ROW EXECUTE FUNCTION verify_replacement_attempt_identity()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_attempts.payout_attempt_replacement_identity_guard';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_attempts'::regclass
    AND t.tgname='payout_attempt_replacement_outcome_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_attempt_replacement_outcome_guard BEFORE UPDATE ON public.payout_attempts FOR EACH ROW EXECUTE FUNCTION guard_replacement_attempt_outcome_until_recorder()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_attempt_replacement_outcome_guard BEFORE UPDATE ON public.payout_attempts FOR EACH ROW EXECUTE FUNCTION guard_replacement_attempt_outcome_until_recorder()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_attempts.payout_attempt_replacement_outcome_guard';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_claims'::regclass
    AND t.tgname='guard_tailor_adjustment_payout_claim' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER guard_tailor_adjustment_payout_claim BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION guard_tailor_adjustment_payout_claim()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER guard_tailor_adjustment_payout_claim BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION guard_tailor_adjustment_payout_claim()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_claims.guard_tailor_adjustment_payout_claim';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_claims'::regclass
    AND t.tgname='payout_claim_blocked_transition_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_claim_blocked_transition_guard BEFORE UPDATE OF status ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION prevent_unreviewed_blocked_payout_transition()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_claim_blocked_transition_guard BEFORE UPDATE OF status ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION prevent_unreviewed_blocked_payout_transition()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_claims.payout_claim_blocked_transition_guard';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_claims'::regclass
    AND t.tgname='payout_claim_confirm_order_work' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_claim_confirm_order_work AFTER UPDATE OF status, transfer_status, provider_transfer_id ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.confirm_order_work_payout_from_claim()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_claim_confirm_order_work AFTER UPDATE OF status, transfer_status, provider_transfer_id ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.confirm_order_work_payout_from_claim()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_claims.payout_claim_confirm_order_work';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_claims'::regclass
    AND t.tgname='payout_claim_fabric_locked_destination_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_claim_fabric_locked_destination_guard BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION guard_fabric_claim_locked_destination()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_claim_fabric_locked_destination_guard BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION guard_fabric_claim_locked_destination()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_claims.payout_claim_fabric_locked_destination_guard';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_claims'::regclass
    AND t.tgname='payout_claim_material_source_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_claim_material_source_guard BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION guard_material_claim_source_identity()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_claim_material_source_guard BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION guard_material_claim_source_identity()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_claims.payout_claim_material_source_guard';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_claims'::regclass
    AND t.tgname='payout_claim_new_order_earning_eligibility' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_claim_new_order_earning_eligibility BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.guard_new_order_earning_claim_eligibility()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_claim_new_order_earning_eligibility BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.guard_new_order_earning_claim_eligibility()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_claims.payout_claim_new_order_earning_eligibility';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_claims'::regclass
    AND t.tgname='payout_claim_order_policy_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_claim_order_policy_guard BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.guard_order_payout_claim_policy()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_claim_order_policy_guard BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.guard_order_payout_claim_policy()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_claims.payout_claim_order_policy_guard';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_claims'::regclass
    AND t.tgname='payout_claim_payout_link_immutable' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_claim_payout_link_immutable BEFORE UPDATE OF payout_id ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION freeze_payout_claim_link()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_claim_payout_link_immutable BEFORE UPDATE OF payout_id ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION freeze_payout_claim_link()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_claims.payout_claim_payout_link_immutable';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_claims'::regclass
    AND t.tgname='payout_claim_require_staged_work_before_provider' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_claim_require_staged_work_before_provider BEFORE UPDATE OF status ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.require_tranche_work_before_provider()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_claim_require_staged_work_before_provider BEFORE UPDATE OF status ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.require_tranche_work_before_provider()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_claims.payout_claim_require_staged_work_before_provider';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_claims'::regclass
    AND t.tgname='payout_claim_reserve_staged_work' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_claim_reserve_staged_work AFTER INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.reserve_staged_work_for_payout()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_claim_reserve_staged_work AFTER INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.reserve_staged_work_for_payout()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_claims.payout_claim_reserve_staged_work';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_claims'::regclass
    AND t.tgname='payout_claim_tranche_source_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_claim_tranche_source_guard BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION guard_tranche_claim_source_identity()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_claim_tranche_source_guard BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION guard_tranche_claim_source_identity()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_claims.payout_claim_tranche_source_guard';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_claims'::regclass
    AND t.tgname='payout_claims_guard_staged_residual_eligibility' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_claims_guard_staged_residual_eligibility BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.guard_staged_residual_eligibility()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_claims_guard_staged_residual_eligibility BEFORE INSERT ON public.payout_claims FOR EACH ROW EXECUTE FUNCTION payment_internal.guard_staged_residual_eligibility()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_claims.payout_claims_guard_staged_residual_eligibility';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_provider_operations'::regclass
    AND t.tgname='a0_claimed_replacement_refund_race_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER a0_claimed_replacement_refund_race_guard BEFORE INSERT ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION guard_claimed_replacement_against_refund()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER a0_claimed_replacement_refund_race_guard BEFORE INSERT ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION guard_claimed_replacement_against_refund()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_provider_operations.a0_claimed_replacement_refund_race_guard';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_provider_operations'::regclass
    AND t.tgname='adjustment_provider_review_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER adjustment_provider_review_guard BEFORE INSERT ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION guard_reviewed_adjustment_provider_operation()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER adjustment_provider_review_guard BEFORE INSERT ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION guard_reviewed_adjustment_provider_operation()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_provider_operations.adjustment_provider_review_guard';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_provider_operations'::regclass
    AND t.tgname='payout_operation_prepare_replacement_attempt' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_operation_prepare_replacement_attempt AFTER UPDATE OF status ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION prepare_replacement_attempt_on_start()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_operation_prepare_replacement_attempt AFTER UPDATE OF status ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION prepare_replacement_attempt_on_start()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_provider_operations.payout_operation_prepare_replacement_attempt';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_provider_operations'::regclass
    AND t.tgname='payout_provider_operation_correction_number_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_provider_operation_correction_number_guard BEFORE INSERT ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION require_matching_payout_correction_operation()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_provider_operation_correction_number_guard BEFORE INSERT ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION require_matching_payout_correction_operation()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_provider_operations.payout_provider_operation_correction_number_guard';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_provider_operations'::regclass
    AND t.tgname='payout_provider_operation_destination_fingerprints' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_provider_operation_destination_fingerprints BEFORE INSERT ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION verify_provider_operation_destination_fingerprints()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_provider_operation_destination_fingerprints BEFORE INSERT ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION verify_provider_operation_destination_fingerprints()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_provider_operations.payout_provider_operation_destination_fingerprints';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_provider_operations'::regclass
    AND t.tgname='payout_provider_operation_evidence_immutable' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_provider_operation_evidence_immutable BEFORE UPDATE ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION prevent_provider_operation_evidence_rewrite()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_provider_operation_evidence_immutable BEFORE UPDATE ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION prevent_provider_operation_evidence_rewrite()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_provider_operations.payout_provider_operation_evidence_immutable';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_provider_operations'::regclass
    AND t.tgname='payout_provider_operation_late_success_freeze' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_provider_operation_late_success_freeze AFTER UPDATE OF status ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION freeze_claim_on_late_provider_operation_success()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_provider_operation_late_success_freeze AFTER UPDATE OF status ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION freeze_claim_on_late_provider_operation_success()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_provider_operations.payout_provider_operation_late_success_freeze';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_provider_operations'::regclass
    AND t.tgname='payout_provider_operation_outcome_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_provider_operation_outcome_guard BEFORE UPDATE ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION guard_payout_provider_operation_outcome()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_provider_operation_outcome_guard BEFORE UPDATE ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION guard_payout_provider_operation_outcome()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_provider_operations.payout_provider_operation_outcome_guard';
  END IF;
END
$bind$;

DO $bind$
DECLARE v_actual text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_actual
  FROM pg_trigger t
  WHERE t.tgrelid='public.payout_provider_operations'::regclass
    AND t.tgname='payout_provider_operation_reservation_guard' AND NOT t.tgisinternal;
  IF v_actual IS NULL THEN
    EXECUTE $guard_ddl$CREATE TRIGGER payout_provider_operation_reservation_guard BEFORE INSERT ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION validate_payout_provider_operation_reservation()$guard_ddl$;
  ELSIF v_actual IS DISTINCT FROM $guard_ddl$CREATE TRIGGER payout_provider_operation_reservation_guard BEFORE INSERT ON public.payout_provider_operations FOR EACH ROW EXECUTE FUNCTION validate_payout_provider_operation_reservation()$guard_ddl$ THEN
    RAISE EXCEPTION 'Claim guard binding differs: public.payout_provider_operations.payout_provider_operation_reservation_guard';
  END IF;
END
$bind$;
