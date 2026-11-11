-- Isolated real-Postgres fixture. Column names and types were read from Dev
-- pg_catalog on 2026-11-10. Constraints unrelated to the tested functions
-- are intentionally omitted so fixture rows can be constructed locally.
create schema if not exists payment_internal;
set search_path=public;
create type public.availability_status as enum ('OPEN','LIMITED','FULLY_BOOKED');
create type public.currency as enum ('GBP','USD','EUR','NGN','GHS','KES','CAD');
create type public.delivery_method as enum ('SHIPPING','LOCAL_COLLECTION','LOCAL_DELIVERY');
create type public.fabric_source as enum ('CUSTOMER_SUPPLIES','TAILOR_SOURCES');
create type public.order_kind as enum ('CUSTOM','READY_MADE');
create type public.order_payment_phase as enum ('INITIAL_ORDER','CONSULTATION','FULFILLMENT','MATERIAL_ADVANCE','ADJUSTMENT','TIP');
create type public.order_payment_status as enum ('INITIATED','PENDING','SUCCEEDED','FAILED','CANCELED','REFUNDED','PARTIAL_REFUND');
create type public.order_stage as enum ('DRAFT','PENDING_QUOTE','CONSULTATION','QUOTE_SENT','PAYMENT_PENDING','CONFIRMED','DESIGNING','SOURCING','CUTTING','SEWING','FINISHING','READY_FOR_DRAPE_DISPATCH','OUT_FOR_DELIVERY','SHIPPED','READY_FOR_COLLECTION','DELIVERED','COLLECTED','COMPLETE','DECLINED','EXPIRED','IN_DISPUTE','PARTIALLY_REFUNDED','REFUNDED','CANCELLED','PAYMENT_FAILED');
create type public.payment_provider as enum ('STRIPE','PAYSTACK','COVERAGE','BACHS');
create type public.payout_account_type as enum ('PAYSTACK','STRIPE_CONNECT');
create type public.payout_status as enum ('PENDING','PROCESSING','PAID','FAILED','REVERSED','CANCELED','BLOCKED');
create type public.seller_type as enum ('TAILOR','BOUTIQUE','TAILOR_SHOP');
create type public.tailor_tier as enum ('VERIFIED','RISING','MASTER');
create table public.commercial_ledger_entries (
  "id" uuid,
  "transaction_id" uuid,
  "order_id" text,
  "account_code" text,
  "account_scope" text,
  "direction" text,
  "amount" integer,
  "currency" currency,
  "created_at" timestamp with time zone
);
create table public.commercial_ledger_transactions (
  "id" uuid,
  "idempotency_key" text,
  "request_hash" text,
  "transaction_kind" text,
  "purpose" text,
  "order_id" text,
  "payment_id" uuid,
  "reversal_of_transaction_id" uuid,
  "policy_version" text,
  "pricing_version" integer,
  "correlation_id" uuid,
  "actor_id" uuid,
  "actor_role" text,
  "original_currency" currency,
  "original_amount" integer,
  "settlement_currency" currency,
  "settlement_amount" integer,
  "fx_rate" numeric(18,8),
  "provider_fee_amount" integer,
  "provider_reference" text,
  "metadata" jsonb,
  "occurred_at" timestamp with time zone,
  "created_at" timestamp with time zone
);
create table public.money_desk_requests (
  "id" uuid,
  "reference" text,
  "idempotency_key" text,
  "request_hash" text,
  "action_type" text,
  "status" text,
  "target_type" text,
  "target_id" text,
  "order_id" text,
  "case_id" uuid,
  "amount" integer,
  "currency" currency,
  "amount_usd_equivalent" integer,
  "usd_equivalent_source" text,
  "reason" text,
  "action_payload" jsonb,
  "requester_email" text,
  "requester_subject" text,
  "requester_role" text,
  "requester_jit_grant_id" uuid,
  "risk_level" text,
  "risk_reasons" text[],
  "required_approval_count" integer,
  "approval_count" integer,
  "policy_version" text,
  "correlation_id" uuid,
  "approved_at" timestamp with time zone,
  "rejected_at" timestamp with time zone,
  "executing_at" timestamp with time zone,
  "terminal_at" timestamp with time zone,
  "execution_outcome" text,
  "provider_reference" text,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "requester_principal_id" uuid,
  "requester_auth_user_id" uuid,
  "requester_aal" text,
  "requester_mfa_at" timestamp with time zone,
  "requester_assurance_source" text
);
create table public.ops_issues (
  "id" uuid,
  "issue_number" bigint,
  "issue_type" text,
  "severity" text,
  "status" text,
  "source" text,
  "actor_id" text,
  "actor_role" text,
  "order_id" text,
  "user_id" text,
  "tailor_profile_id" text,
  "related_entity_type" text,
  "related_entity_id" text,
  "provider" text,
  "stage" text,
  "title" text,
  "description" text,
  "recommended_action" text,
  "dedupe_key" text,
  "assigned_to" text,
  "metadata" jsonb,
  "resolved_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "case_number" text,
  "queue_key" text,
  "owning_team" text,
  "priority" text,
  "sensitivity" text,
  "environment" text,
  "canonical_status" text,
  "assigned_principal_id" uuid,
  "claimed_at" timestamp with time zone,
  "scheduled_follow_up_at" timestamp with time zone,
  "first_response_due_at" timestamp with time zone,
  "active_resolution_due_at" timestamp with time zone,
  "first_responded_at" timestamp with time zone,
  "active_duration_seconds" bigint,
  "paused_duration_seconds" bigint,
  "sla_policy_version" text,
  "correlation_id" uuid,
  "record_version" bigint,
  "provenance" text,
  "reopened_from_issue_id" uuid,
  "closed_at" timestamp with time zone,
  "retention_until" timestamp with time zone,
  "sla_clock_paused_at" timestamp with time zone,
  "last_meaningful_activity_at" timestamp with time zone
);
create table public.order_payment_provider_refunds (
  "id" uuid,
  "payment_id" uuid,
  "provider" payment_provider,
  "provider_refund_id" text,
  "amount" integer,
  "status" text,
  "provider_response" jsonb,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone
);
create table public.order_payment_refund_claims (
  "id" uuid,
  "payment_id" uuid,
  "order_id" text,
  "phase" order_payment_phase,
  "provider" payment_provider,
  "currency" currency,
  "charged_amount" integer,
  "refunded_before" integer,
  "refund_amount" integer,
  "provider_payment_id" text,
  "operation_key" text,
  "status" text,
  "provider_refund_id" text,
  "provider_evidence" jsonb,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "refund_context" jsonb
);
create table public.order_payments (
  "id" uuid,
  "order_id" text,
  "phase" order_payment_phase,
  "provider" payment_provider,
  "currency" currency,
  "amount" integer,
  "status" order_payment_status,
  "idempotency_key" text,
  "provider_payment_id" text,
  "provider_checkout_url" text,
  "provider_response" jsonb,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "confirmed_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "refunded_at" timestamp with time zone,
  "refunded_amount" integer,
  "partial_refund_count" integer,
  "last_refund_amount" integer,
  "last_refund_at" timestamp with time zone,
  "policy_version" text,
  "pricing_version" integer,
  "correlation_id" uuid,
  "commercial_breakdown" jsonb,
  "ledger_recorded_at" timestamp with time zone,
  "pricing_reservation_id" uuid,
  "tax_decision_snapshot_id" uuid,
  "fabric_candidate_id" uuid,
  "consultation_booking_id" uuid,
  "consultation_booking_link_source" text,
  "provider_charge_id" text,
  "provider_request_state" text
);
create table public.order_settlement_events (
  "id" uuid,
  "plan_id" uuid,
  "tranche_id" uuid,
  "event_type" text,
  "actor_role" text,
  "payload" jsonb,
  "correlation_id" uuid,
  "created_at" timestamp with time zone
);
create table public.order_settlement_plans (
  "id" uuid,
  "order_id" text,
  "customer_id" uuid,
  "tailor_id" uuid,
  "source_payment_id" uuid,
  "method" text,
  "policy_version" text,
  "currency" currency,
  "entitlement_amount" integer,
  "status" text,
  "frozen_reason" text,
  "correlation_id" uuid,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "seller_subtotal_amount" integer,
  "excluded_fabric_allowance_amount" integer,
  "material_recovery_offset_amount" integer
);
create table public.order_settlement_tranches (
  "id" uuid,
  "plan_id" uuid,
  "order_id" text,
  "code" text,
  "sequence" integer,
  "basis_points" integer,
  "amount" integer,
  "currency" currency,
  "status" text,
  "eligible_at" timestamp with time zone,
  "released_at" timestamp with time zone,
  "blocked_reason" text,
  "eligibility_ledger_transaction_id" uuid,
  "release_ledger_transaction_id" uuid,
  "payout_id" text,
  "money_desk_request_id" uuid,
  "provider_reference" text,
  "correlation_id" uuid,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone
);
create table public.order_work_funding_positions (
  "id" uuid,
  "source_payment_id" uuid,
  "use_kind" text,
  "payout_claim_id" uuid,
  "refund_claim_id" uuid,
  "amount" integer,
  "status" text,
  "created_at" timestamp with time zone
);
create table public.order_work_funding_sources (
  "payment_id" uuid,
  "plan_id" uuid,
  "order_id" text,
  "currency" currency,
  "captured_tailor_amount" integer,
  "created_at" timestamp with time zone
);
create table public.orders (
  "id" text,
  "reference" text,
  "customer_id" text,
  "tailor_id" text,
  "tailor_profile_id" text,
  "garment_type" text,
  "garment_description" text,
  "occasion" text,
  "deadline" timestamp(3) without time zone,
  "fabric_source" fabric_source,
  "delivery_method" delivery_method,
  "special_note" text,
  "fabric_tracking" text,
  "reference_photos" text[],
  "customer_measurements_snapshot" jsonb,
  "fit_note" text,
  "quoted_amount" integer,
  "currency" currency,
  "quoted_completion_date" timestamp(3) without time zone,
  "quote_note" text,
  "quote_expires_at" timestamp(3) without time zone,
  "stage" order_stage,
  "stage_updated_at" timestamp(3) without time zone,
  "payment_provider" payment_provider,
  "payment_intent_id" text,
  "escrow_released" boolean,
  "escrow_released_at" timestamp(3) without time zone,
  "auto_release_at" timestamp(3) without time zone,
  "collection_code" text,
  "collection_code_expiry" timestamp(3) without time zone,
  "collection_code_used" boolean,
  "created_at" timestamp(3) without time zone,
  "updated_at" timestamp(3) without time zone,
  "consultation_fee" integer,
  "tracking_number" text,
  "carrier" text,
  "video_call_url" text,
  "delivery_address" text,
  "quoted_currency" text,
  "collection_code_attempts" integer,
  "order_kind" order_kind,
  "seller_item_id" text,
  "item_title" text,
  "item_size" text,
  "item_quantity" integer,
  "item_unit_price" integer,
  "item_subtotal" integer,
  "fulfillment_option" text,
  "payment_checkout_url" text,
  "fulfillment_fee" integer,
  "collection_code_last_attempt_at" timestamp with time zone,
  "recipient_name" text,
  "recipient_phone" text,
  "fulfillment_provider" text,
  "fulfillment_reference" text,
  "fulfillment_contact_name" text,
  "fulfillment_contact_phone" text,
  "fulfillment_payment_requested_at" timestamp with time zone,
  "fulfillment_payment_paid_at" timestamp with time zone,
  "fulfillment_payment_provider" payment_provider,
  "fulfillment_payment_intent_id" text,
  "fulfillment_payment_checkout_url" text,
  "source_currency" currency,
  "source_amount" integer,
  "fx_rate" numeric(18,8),
  "fx_rate_timestamp" timestamp with time zone,
  "subtotal_amount" integer,
  "platform_fee_amount" integer,
  "tax_amount" integer,
  "tax_rate_bps" integer,
  "shipping_amount" integer,
  "total_amount" integer,
  "delivery_city" text,
  "delivery_region" text,
  "delivery_postal_code" text,
  "delivery_country_code" text,
  "tax_region" text,
  "tax_fallback" boolean,
  "tax_fallback_reason" text,
  "handoff_completed_at" timestamp with time zone,
  "customer_handoff_confirmed_at" timestamp with time zone,
  "handoff_confirmation_source" text,
  "tailor_payout_currency_locked" currency,
  "tailor_payout_provider_locked" payment_provider,
  "tailor_paystack_recipient_code_locked" text,
  "tailor_stripe_connect_account_id_locked" text,
  "ops_payout_resolution_mode" text,
  "ops_payout_override_currency" currency,
  "ops_payout_override_provider" payment_provider,
  "ops_payout_override_amount" integer,
  "ops_payout_override_fx_rate" numeric(18,8),
  "ops_payout_override_fx_rate_timestamp" timestamp with time zone,
  "ops_payout_override_note" text,
  "ops_payout_override_set_at" timestamp with time zone,
  "ops_payout_override_set_by" text,
  "active_quote_id" uuid,
  "active_quote_version" integer,
  "negotiation_round_limit" integer,
  "negotiation_rounds_used" integer,
  "commercial_policy_version" text,
  "fabric_funding_policy_version" text,
  "fulfillment_contract_version" text,
  "fulfillment_policy_version" text,
  "fulfillment_classification" text,
  "fulfillment_origin_snapshot" jsonb,
  "fulfillment_destination_snapshot" jsonb,
  "fulfillment_corridor_control_id" uuid,
  "fulfillment_collection_mode" text,
  "fulfillment_fingerprint" text,
  "fulfillment_resolved_at" timestamp with time zone,
  "pricing_invalidated_at" timestamp with time zone,
  "pricing_invalidation_reason" text,
  "tax_decision_snapshot_id" uuid,
  "import_tax_amount" integer,
  "duty_amount" integer,
  "tax_collection_mode" text,
  "tax_responsible_party" text,
  "description" text,
  "reference_photo_attributions" jsonb,
  "payment_route_id" uuid,
  "payment_route_version" integer,
  "legal_entity_snapshot" text,
  "charge_provider_snapshot" text,
  "charge_currency_snapshot" text,
  "payout_destination_id" uuid,
  "fee_schedule_version_snapshot" text,
  "delivery_country_rule_id" uuid,
  "delivery_country_rule_version" integer,
  "tax_duty_snapshot" jsonb,
  "accepted_earning_amount" integer,
  "tailor_terms_version_snapshot" text,
  "accepted_route_snapshot_at" timestamp with time zone,
  "id_text" text
);
create table public.payout_claims (
  "id" uuid,
  "business_key" text,
  "source_kind" text,
  "source_id" text,
  "order_id" text,
  "tailor_profile_id" text,
  "provider" text,
  "provider_destination_id" text,
  "currency" currency,
  "amount" integer,
  "route_version" text,
  "earning_policy_version" text,
  "tailor_terms_version" text,
  "provider_idempotency_key" text,
  "status" text,
  "transfer_status" text,
  "withdrawal_status" text,
  "payout_id" text,
  "provider_transfer_id" text,
  "last_provider_checked_at" timestamp with time zone,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "payout_ledger_transaction_id" uuid
);
create table public.payout_destinations (
  "id" uuid,
  "tailor_profile_id" text,
  "provider" text,
  "legal_entity" text,
  "country_code" text,
  "currency" text,
  "provider_account_ref" text,
  "transfers_enabled" boolean,
  "payouts_enabled" boolean,
  "fees_collector" text,
  "first_withdrawal_review_status" text,
  "active" boolean,
  "capability_checked_at" timestamp with time zone,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "provider_onboarding_due_count" smallint,
  "provider_onboarding_pending_count" smallint,
  "provider_onboarding_checked_at" timestamp with time zone,
  "provider_requirements_currently_due_count" smallint,
  "provider_requirements_past_due_count" smallint,
  "provider_disabled_reason" text,
  "provider_external_account_present" boolean
);
create table public.payout_provider_operations (
  "id" uuid,
  "claim_id" uuid,
  "operation_number" integer,
  "provider" text,
  "provider_destination_id" text,
  "currency" currency,
  "amount" integer,
  "provider_idempotency_key" text,
  "status" text,
  "reviewed_correction_id" uuid,
  "money_desk_request_id" uuid,
  "final_failure_reference" text,
  "funds_return_reference" text,
  "funds_return_confirmed_at" timestamp with time zone,
  "provider_transfer_id" text,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "provider_source_transaction_id" text
);
create table public.payouts (
  "id" text,
  "tailor_profile_id" text,
  "amount" integer,
  "currency" currency,
  "provider" payment_provider,
  "provider_payout_id" text,
  "order_id" text,
  "processed_at" timestamp(3) without time zone,
  "status" payout_status,
  "source_payment_id" uuid,
  "provider_response" jsonb,
  "blocked_reason" text,
  "initiated_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "settlement_tranche_id" uuid,
  "material_advance_id" uuid,
  "provider_transfer_status" text,
  "bank_settlement_status" text,
  "provider_destination_id" text,
  "provider_bank_payout_id" text,
  "bank_settlement_expected_at" timestamp with time zone,
  "bank_settlement_completed_at" timestamp with time zone,
  "bank_settlement_failed_at" timestamp with time zone,
  "bank_settlement_failure_code" text,
  "fabric_candidate_id" uuid,
  "payout_purpose" text,
  "id_text" text,
  "consultation_booking_id" uuid,
  "tailor_adjustment_id" uuid,
  "provider_transfer_confirmed_observed_at" timestamp with time zone
);
create table public.tailor_profiles (
  "id" text,
  "user_id" text,
  "display_name" text,
  "business_name" text,
  "bio" text,
  "location" text,
  "languages" text[],
  "specialty_tags" text[],
  "price_range_min" integer,
  "price_range_max" integer,
  "currency" currency,
  "tier" tailor_tier,
  "availability" availability_status,
  "is_verified" boolean,
  "is_live" boolean,
  "avg_rating" double precision,
  "total_reviews" integer,
  "total_orders" integer,
  "avg_response_hours" double precision,
  "ships_internationally" boolean,
  "stripe_account_id" text,
  "paystack_account_id" text,
  "id_verification_status" text,
  "id_document_path" text,
  "id_document_url" text,
  "id_verified_at" timestamp(3) without time zone,
  "portfolio_photo_urls" text[],
  "bypass_attempts" integer,
  "tier_lost_at" timestamp(3) without time zone,
  "created_at" timestamp(3) without time zone,
  "updated_at" timestamp(3) without time zone,
  "portfolio_video_urls" text[],
  "avatar_url" text,
  "profile_completed" boolean,
  "ranking_score" integer,
  "seller_type" seller_type,
  "supports_custom_orders" boolean,
  "supports_ready_made" boolean,
  "pickup_available" boolean,
  "delivery_available" boolean,
  "shipping_available" boolean,
  "delivery_fee" integer,
  "shipping_fee" integer,
  "payout_currency" currency,
  "payout_provider" payment_provider,
  "payout_reverification_required" boolean,
  "payout_account_type" payout_account_type,
  "payout_account_verified" boolean,
  "paystack_recipient_code" text,
  "stripe_connect_account_id" text,
  "payout_account_verified_at" timestamp with time zone,
  "payout_bank_name" text,
  "payout_bank_code" text,
  "payout_account_name" text,
  "payout_account_masked" text,
  "payout_country_code" text,
  "manual_bank_entry" boolean,
  "manual_bank_name" text,
  "manual_bank_country_code" text,
  "manual_bank_country_name" text,
  "manual_bank_swift_bic" text,
  "manual_bank_account_number" text,
  "manual_bank_account_name" text,
  "manual_bank_verification_status" text,
  "manual_bank_submitted_at" timestamp with time zone,
  "manual_bank_verified_at" timestamp with time zone,
  "manual_bank_verified_by" text,
  "payout_account_change_count" integer,
  "payout_account_last_changed_at" timestamp with time zone,
  "payout_account_change_locked_until" timestamp with time zone,
  "payout_destination_hold_until" timestamp with time zone,
  "id_selfie_document_url" text,
  "id_verification_method" text,
  "id_verification_handoff_id" uuid,
  "id_verification_submitted_at" timestamp with time zone,
  "id_verification_rejection_reason" text,
  "id_verification_rejected_at" timestamp with time zone,
  "id_verification_metadata" jsonb,
  "accepts_custom_orders_now" boolean,
  "shop_paused" boolean,
  "legal_name" text,
  "payout_name_match_status" text,
  "payout_name_match_checked_at" timestamp with time zone,
  "payout_name_match_metadata" jsonb,
  "trust_verification_video_path" text,
  "trust_verification_challenge_id" text,
  "trust_verification_challenge_text" text,
  "consultation_mode" text,
  "consultation_requirement" text,
  "consultation_fee_amount" integer,
  "consultation_currency" currency,
  "consultation_duration_minutes" integer,
  "consultation_call_type" text,
  "consultation_fee_creditable" boolean,
  "consultation_policy_version" text,
  "consultation_policy_published_at" timestamp with time zone,
  "is_test_profile" boolean,
  "id_text" text
);

-- Defaults and uniqueness used by the live reservation functions.
alter table public.payout_claims alter column id set default gen_random_uuid();
alter table public.payout_claims alter column status set default 'RESERVED';
alter table public.payout_claims alter column transfer_status set default 'NOT_STARTED';
alter table public.payout_claims alter column withdrawal_status set default 'NOT_STARTED';
alter table public.payouts alter column id set default gen_random_uuid()::text;
alter table public.payout_provider_operations alter column id set default gen_random_uuid();
alter table public.payout_provider_operations alter column status set default 'RESERVED';
alter table public.order_work_funding_positions alter column id set default gen_random_uuid();
alter table public.order_work_funding_positions alter column status set default 'RESERVED';
create unique index order_work_funding_sources_payment_fixture
  on public.order_work_funding_sources(payment_id);
create unique index payout_provider_operations_claim_number_fixture
  on public.payout_provider_operations(claim_id,operation_number);

create extension if not exists pgcrypto;
alter table public.commercial_ledger_transactions
  alter column id set default gen_random_uuid();
create unique index commercial_ledger_idempotency_fixture
  on public.commercial_ledger_transactions(idempotency_key);

-- Unmodified live Dev ledger writer, needed for the full finalization proof.
CREATE OR REPLACE FUNCTION public.post_commercial_ledger_transaction(p_idempotency_key text, p_transaction_kind text, p_purpose text, p_order_id text, p_payment_id uuid, p_policy_version text, p_pricing_version integer, p_correlation_id uuid, p_provider_reference text, p_entries jsonb, p_metadata jsonb DEFAULT '{}'::jsonb, p_reversal_of_transaction_id uuid DEFAULT NULL::uuid, p_actor_id uuid DEFAULT NULL::uuid, p_actor_role text DEFAULT 'SYSTEM'::text, p_original_currency currency DEFAULT NULL::currency, p_original_amount integer DEFAULT NULL::integer, p_settlement_currency currency DEFAULT NULL::currency, p_settlement_amount integer DEFAULT NULL::integer, p_fx_rate numeric DEFAULT 1, p_provider_fee_amount integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_request_hash text;
  v_transaction_id uuid;
  v_existing_hash text;
  v_entry jsonb;
  v_debits bigint;
  v_credits bigint;
  v_original_currency currency;
  v_original_amount integer;
  v_settlement_currency currency;
  v_settlement_amount integer;
begin
  if nullif(trim(p_idempotency_key), '') is null then raise exception 'Ledger idempotency key is required.'; end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) < 2 then
    raise exception 'Ledger transaction requires at least two entries.';
  end if;

  select coalesce(sum((entry->>'amount')::bigint) filter (where entry->>'direction' = 'DEBIT'), 0),
         coalesce(sum((entry->>'amount')::bigint) filter (where entry->>'direction' = 'CREDIT'), 0)
    into v_debits, v_credits
  from jsonb_array_elements(p_entries) entry;

  if v_debits <= 0 or v_debits <> v_credits then
    raise exception 'Ledger transaction is unbalanced: % debit, % credit.', v_debits, v_credits;
  end if;
  if p_actor_role not in ('CUSTOMER', 'TAILOR', 'OPS', 'SYSTEM') then raise exception 'Invalid ledger actor role.'; end if;
  if coalesce(p_fx_rate, 0) <= 0 then raise exception 'Ledger FX rate must be positive.'; end if;
  if coalesce(p_provider_fee_amount, 0) < 0 then raise exception 'Provider fee amount cannot be negative.'; end if;

  v_original_currency := coalesce(p_original_currency, (p_entries->0->>'currency')::currency);
  v_original_amount := coalesce(p_original_amount, v_debits::integer);
  v_settlement_currency := coalesce(p_settlement_currency, v_original_currency);
  v_settlement_amount := coalesce(p_settlement_amount, v_original_amount);
  if v_original_amount <= 0 or v_settlement_amount <= 0 then
    raise exception 'Ledger original and settlement amounts must be positive.';
  end if;

  v_request_hash := encode(digest(concat_ws('|', p_transaction_kind, p_purpose,
    coalesce(p_order_id, ''), coalesce(p_payment_id::text, ''), p_policy_version,
    p_pricing_version::text, coalesce(p_provider_reference, ''), p_entries::text,
    coalesce(p_metadata, '{}'::jsonb)::text, coalesce(p_reversal_of_transaction_id::text, ''),
    coalesce(p_actor_id::text, ''), p_actor_role, v_original_currency::text,
    v_original_amount::text, v_settlement_currency::text, v_settlement_amount::text,
    p_fx_rate::text, coalesce(p_provider_fee_amount, 0)::text
  ), 'sha256'), 'hex');

  insert into public.commercial_ledger_transactions (
    idempotency_key, request_hash, transaction_kind, purpose, order_id, payment_id,
    reversal_of_transaction_id, policy_version, pricing_version, correlation_id,
    actor_id, actor_role, original_currency, original_amount, settlement_currency,
    settlement_amount, fx_rate, provider_fee_amount, provider_reference, metadata
  ) values (
    p_idempotency_key, v_request_hash, p_transaction_kind, p_purpose, p_order_id, p_payment_id,
    p_reversal_of_transaction_id, p_policy_version, p_pricing_version, p_correlation_id,
    p_actor_id, p_actor_role, v_original_currency, v_original_amount, v_settlement_currency,
    v_settlement_amount, p_fx_rate, coalesce(p_provider_fee_amount, 0), p_provider_reference,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing
  returning id into v_transaction_id;

  if v_transaction_id is null then
    select id, request_hash into v_transaction_id, v_existing_hash
    from public.commercial_ledger_transactions
    where idempotency_key = p_idempotency_key;
    if v_existing_hash <> v_request_hash then
      raise exception 'Ledger idempotency key was reused with different values.';
    end if;
    return v_transaction_id;
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries)
  loop
    if (v_entry->>'amount')::integer <= 0 then raise exception 'Ledger entry amount must be positive.'; end if;
    insert into public.commercial_ledger_entries (
      transaction_id, order_id, account_code, account_scope, direction, amount, currency
    ) values (
      v_transaction_id,
      p_order_id,
      v_entry->>'accountCode',
      coalesce(nullif(v_entry->>'accountScope', ''), 'default'),
      v_entry->>'direction',
      (v_entry->>'amount')::integer,
      (v_entry->>'currency')::currency
    );
  end loop;

  return v_transaction_id;
end;
$function$
;

-- Unmodified staged funding position confirmation trigger.
CREATE OR REPLACE FUNCTION payment_internal.confirm_order_work_payout_from_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.source_kind in ('SETTLEMENT_TRANCHE','RESIDUAL_SETTLEMENT')
    and new.status in ('TRANSFERRED','WITHDRAWN')
    and new.transfer_status='CONFIRMED'
    and nullif(btrim(new.provider_transfer_id),'') is not null then
    update public.order_work_funding_positions set status='PAYOUT_CONFIRMED'
      where payout_claim_id=new.id and use_kind='PAYOUT' and status='RESERVED';
  end if;
  return new;
end $function$
;
