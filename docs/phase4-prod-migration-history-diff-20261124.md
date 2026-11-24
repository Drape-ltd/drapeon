# Production migration-history difference — 2026-11-24

Read-only comparison of migration filenames at `origin/main` `528dc5ed` against Drape-PROD `supabase_migrations.schema_migrations`. The inventory branch has the same migration tree as that `main` head. An absent marker does **not** prove absent schema or authorize a broad push. The original SQL, current catalog and dependency chain must be reviewed before any exact-version Production approval.

| Category | Count |
| --- | ---: |
| #235 PAY-003/C2 forward versions | 7 |
| Documented Dev-only #219 versions | 3 |
| Untriaged history gaps | 137 |
| **Total** | **147** |

## Exact absent versions

| Version | Source file | Classification |
| --- | --- | --- |
| `20260915133000` | `supabase/migrations/20260915133000_lifecycle_survey_responses.sql` | Untriaged; do not promote without catalog review |
| `20260915143000` | `supabase/migrations/20260915143000_lifecycle_survey_invite_schedule.sql` | Untriaged; do not promote without catalog review |
| `20260915150000` | `supabase/migrations/20260915150000_marketing_topic_preferences.sql` | Untriaged; do not promote without catalog review |
| `20260915153000` | `supabase/migrations/20260915153000_campaign_topic_binding.sql` | Untriaged; do not promote without catalog review |
| `20260920100000` | `supabase/migrations/20260920100000_guard_new_tailor_drop_audiences.sql` | Untriaged; do not promote without catalog review |
| `20260920113000` | `supabase/migrations/20260920113000_harden_marketing_recipient_role_lookup.sql` | Untriaged; do not promote without catalog review |
| `20260929160000` | `supabase/migrations/20260929160000_refresh_stale_trust_exception.sql` | Untriaged; do not promote without catalog review |
| `20260929161000` | `supabase/migrations/20260929161000_refresh_trust_exception_profile_key_compat.sql` | Untriaged; do not promote without catalog review |
| `20260929162000` | `supabase/migrations/20260929162000_repair_trust_exception_refresh_rpc.sql` | Untriaged; do not promote without catalog review |
| `20260929163000` | `supabase/migrations/20260929163000_reload_postgrest_after_trust_exception_rpc.sql` | Untriaged; do not promote without catalog review |
| `20261002130000` | `supabase/migrations/20261002130000_record_recruitment_waiver_method.sql` | Untriaged; do not promote without catalog review |
| `20261015134548` | `supabase/migrations/20261015134548_ops_queue_server_pagination.sql` | Untriaged; do not promote without catalog review |
| `20261015150802` | `supabase/migrations/20261015150802_cap_ops_sla_reminders.sql` | Untriaged; do not promote without catalog review |
| `20261015150942` | `supabase/migrations/20261015150942_preserve_ops_sla_response_on_automatic_escalation.sql` | Untriaged; do not promote without catalog review |
| `20261015153213` | `supabase/migrations/20261015153213_ops_source_case_creation.sql` | Untriaged; do not promote without catalog review |
| `20261015155317` | `supabase/migrations/20261015155317_ops_queue_filter_parity.sql` | Untriaged; do not promote without catalog review |
| `20261015160444` | `supabase/migrations/20261015160444_ops_grouped_job_failures.sql` | Untriaged; do not promote without catalog review |
| `20261015161242` | `supabase/migrations/20261015161242_ops_grouped_job_review.sql` | Untriaged; do not promote without catalog review |
| `20261015165500` | `supabase/migrations/20261015165500_ops_job_recovery_receipts.sql` | Untriaged; do not promote without catalog review |
| `20261015173015` | `supabase/migrations/20261015173015_quiet_routine_ops_slack_events.sql` | Untriaged; do not promote without catalog review |
| `20261015183256` | `supabase/migrations/20261015183256_quiet_automatic_ops_sla_escalation_slack.sql` | Untriaged; do not promote without catalog review |
| `20261022002558` | `supabase/migrations/20261022002558_tip_money_operation_claims.sql` | Untriaged; do not promote without catalog review |
| `20261022002604` | `supabase/migrations/20261022002604_verify_tip_money_operation_claims.sql` | Untriaged; do not promote without catalog review |
| `20261022002859` | `supabase/migrations/20261022002859_make_tip_claim_provider_neutral.sql` | Untriaged; do not promote without catalog review |
| `20261022003219` | `supabase/migrations/20261022003219_harden_tip_claim_outcomes.sql` | Untriaged; do not promote without catalog review |
| `20261022003329` | `supabase/migrations/20261022003329_unique_tip_payout_business_key.sql` | Untriaged; do not promote without catalog review |
| `20261022003551` | `supabase/migrations/20261022003551_verify_tip_claim_provider_neutral.sql` | Untriaged; do not promote without catalog review |
| `20261022003554` | `supabase/migrations/20261022003554_verify_tip_claim_outcomes.sql` | Untriaged; do not promote without catalog review |
| `20261022003557` | `supabase/migrations/20261022003557_verify_tip_payout_business_key.sql` | Untriaged; do not promote without catalog review |
| `20261022003751` | `supabase/migrations/20261022003751_payout_claims_and_attempts.sql` | Untriaged; do not promote without catalog review |
| `20261022003811` | `supabase/migrations/20261022003811_verify_payout_claims_and_attempts.sql` | Untriaged; do not promote without catalog review |
| `20261022003918` | `supabase/migrations/20261022003918_reserve_payout_claim.sql` | Untriaged; do not promote without catalog review |
| `20261022003952` | `supabase/migrations/20261022003952_verify_reserve_payout_claim.sql` | Untriaged; do not promote without catalog review |
| `20261022004047` | `supabase/migrations/20261022004047_start_payout_attempt.sql` | Untriaged; do not promote without catalog review |
| `20261022004111` | `supabase/migrations/20261022004111_verify_start_payout_attempt.sql` | Untriaged; do not promote without catalog review |
| `20261022004202` | `supabase/migrations/20261022004202_record_payout_attempt_outcome.sql` | Untriaged; do not promote without catalog review |
| `20261022004233` | `supabase/migrations/20261022004233_verify_record_payout_attempt_outcome.sql` | Untriaged; do not promote without catalog review |
| `20261022012820` | `supabase/migrations/20261022012820_finalize_claimed_tip_refund.sql` | Untriaged; do not promote without catalog review |
| `20261022012827` | `supabase/migrations/20261022012827_verify_finalize_claimed_tip_refund.sql` | Untriaged; do not promote without catalog review |
| `20261022023108` | `supabase/migrations/20261022023108_block_payout_identity_conflict.sql` | Untriaged; do not promote without catalog review |
| `20261022023327` | `supabase/migrations/20261022023327_guard_blocked_payout_claim_transition.sql` | Untriaged; do not promote without catalog review |
| `20261022023331` | `supabase/migrations/20261022023331_verify_blocked_payout_claim_guard.sql` | Untriaged; do not promote without catalog review |
| `20261022023739` | `supabase/migrations/20261022023739_block_tip_payout_identity_conflict.sql` | Untriaged; do not promote without catalog review |
| `20261022023742` | `supabase/migrations/20261022023742_verify_blocked_tip_payout_identity_conflict.sql` | Untriaged; do not promote without catalog review |
| `20261022034433` | `supabase/migrations/20261022034433_require_exact_tip_payout_receipt_for_refund.sql` | Untriaged; do not promote without catalog review |
| `20261022034452` | `supabase/migrations/20261022034452_verify_exact_tip_payout_receipt_for_refund.sql` | Untriaged; do not promote without catalog review |
| `20261022034759` | `supabase/migrations/20261022034759_finalize_claimed_stripe_tip_payout.sql` | Untriaged; do not promote without catalog review |
| `20261022035048` | `supabase/migrations/20261022035048_verify_claimed_stripe_tip_payout.sql` | Untriaged; do not promote without catalog review |
| `20261022035404` | `supabase/migrations/20261022035404_settle_waiting_tip_refund_after_payout_receipt.sql` | Untriaged; do not promote without catalog review |
| `20261022035500` | `supabase/migrations/20261022035500_verify_waiting_tip_refund_after_payout_receipt.sql` | Untriaged; do not promote without catalog review |
| `20261022233900` | `supabase/migrations/20261022233900_reserve_order_payment_refund_claim.sql` | Untriaged; do not promote without catalog review |
| `20261022233922` | `supabase/migrations/20261022233922_verify_order_payment_refund_claim.sql` | Untriaged; do not promote without catalog review |
| `20261022234256` | `supabase/migrations/20261022234256_guard_order_payment_refund_claim_identity.sql` | Untriaged; do not promote without catalog review |
| `20261022234319` | `supabase/migrations/20261022234319_verify_order_payment_refund_claim_identity.sql` | Untriaged; do not promote without catalog review |
| `20261022234942` | `supabase/migrations/20261022234942_record_order_payment_refund_claim_outcome.sql` | Untriaged; do not promote without catalog review |
| `20261022235023` | `supabase/migrations/20261022235023_verify_order_payment_refund_claim_outcome.sql` | Untriaged; do not promote without catalog review |
| `20261024223431` | `supabase/migrations/20261024223431_block_confirmed_payout_identity_conflict.sql` | Untriaged; do not promote without catalog review |
| `20261024223443` | `supabase/migrations/20261024223443_verify_block_confirmed_payout_identity_conflict.sql` | Untriaged; do not promote without catalog review |
| `20261024225931` | `supabase/migrations/20261024225931_block_anomalous_confirmed_payout_conflict.sql` | Untriaged; do not promote without catalog review |
| `20261024230021` | `supabase/migrations/20261024230021_verify_anomalous_confirmed_payout_conflict.sql` | Untriaged; do not promote without catalog review |
| `20261025020517` | `supabase/migrations/20261025020517_separate_tip_capture_and_payout_ledgers.sql` | Untriaged; do not promote without catalog review |
| `20261025021016` | `supabase/migrations/20261025021016_freeze_tip_payout_ledger_receipt.sql` | Untriaged; do not promote without catalog review |
| `20261025103949` | `supabase/migrations/20261025103949_verify_tip_payout_ledger_receipt_freeze.sql` | Untriaged; do not promote without catalog review |
| `20261030030000` | `supabase/migrations/20261030030000_pay003_forward_only_payment_status.sql` | Untriaged; do not promote without catalog review |
| `20261030040000` | `supabase/migrations/20261030040000_pay003_refund_failure_reversal.sql` | Untriaged; do not promote without catalog review |
| `20261030050000` | `supabase/migrations/20261030050000_pay003_legacy_refund_baseline.sql` | Untriaged; do not promote without catalog review |
| `20261030060000` | `supabase/migrations/20261030060000_pay003_refund_aggregate_hardening.sql` | Untriaged; do not promote without catalog review |
| `20261030100000` | `supabase/migrations/20261030100000_c2_forward_only_payouts.sql` | Untriaged; do not promote without catalog review |
| `20261030110000` | `supabase/migrations/20261030110000_c2_restore_payout_destinations.sql` | Untriaged; do not promote without catalog review |
| `20261030120000` | `supabase/migrations/20261030120000_c2_returned_funds_forward_repair.sql` | Untriaged; do not promote without catalog review |
| `20261030133137` | `supabase/migrations/20261030133137_dev_ops_supabase_mfa_identity_receipts.sql` | Untriaged; do not promote without catalog review |
| `20261030151320` | `supabase/migrations/20261030151320_repair_local_mfa_receipt_triggers.sql` | Untriaged; do not promote without catalog review |
| `20261102180324` | `supabase/migrations/20261102180324_address_scoped_tax_rate_cache.sql` | Untriaged; do not promote without catalog review |
| `20261102182653` | `supabase/migrations/20261102182653_enforce_address_scoped_tax_rate_cache_primary_key.sql` | Untriaged; do not promote without catalog review |
| `20261102200000` | `supabase/migrations/20261102200000_fabric_release_provider_attempts.sql` | Untriaged; do not promote without catalog review |
| `20261102204053` | `supabase/migrations/20261102204053_bind_claimed_stripe_source_charge.sql` | Untriaged; do not promote without catalog review |
| `20261102210052` | `supabase/migrations/20261102210052_allow_multiple_fabric_payout_attempts.sql` | Untriaged; do not promote without catalog review |
| `20261102234537` | `supabase/migrations/20261102234537_reviewed_fabric_release_job_recovery.sql` | Untriaged; do not promote without catalog review |
| `20261107194113` | `supabase/migrations/20261107194113_cancellation_review_money_desk_refund.sql` | Untriaged; do not promote without catalog review |
| `20261108045200` | `supabase/migrations/20261108045200_dev_third_mfa_approver.sql` | Untriaged; do not promote without catalog review |
| `20261108181600` | `supabase/migrations/20261108181600_push_notification_receipt_audit.sql` | Untriaged; do not promote without catalog review |
| `20261108224000` | `supabase/migrations/20261108224000_reviewed_dispatch_refund_retry.sql` | Untriaged; do not promote without catalog review |
| `20261108224518` | `supabase/migrations/20261108224518_orphaned_job_worker_wakeup.sql` | Untriaged; do not promote without catalog review |
| `20261109013000` | `supabase/migrations/20261109013000_cancellation_refund_canonical_case.sql` | Untriaged; do not promote without catalog review |
| `20261109013500` | `supabase/migrations/20261109013500_repair_cancellation_refund_case_status.sql` | Untriaged; do not promote without catalog review |
| `20261110030000` | `supabase/migrations/20261110030000_money_desk_release_readiness_evidence.sql` | Untriaged; do not promote without catalog review |
| `20261110031000` | `supabase/migrations/20261110031000_customer_refund_receipts.sql` | Untriaged; do not promote without catalog review |
| `20261110042832` | `supabase/migrations/20261110042832_allow_accounted_non_tailor_refunds_for_tranches.sql` | Untriaged; do not promote without catalog review |
| `20261110120000` | `supabase/migrations/20261110120000_allow_reviewed_tranche_destination_correction.sql` | Untriaged; do not promote without catalog review |
| `20261110130000` | `supabase/migrations/20261110130000_reviewed_claimed_payout_retry.sql` | Untriaged; do not promote without catalog review |
| `20261110140000` | `supabase/migrations/20261110140000_finalise_definite_rejected_tranche.sql` | Untriaged; do not promote without catalog review |
| `20261110150000` | `supabase/migrations/20261110150000_close_unstarted_tranche_payouts.sql` | Untriaged; do not promote without catalog review |
| `20261110173730` | `supabase/migrations/20261110173730_reconcile_legacy_push_delivery_audit.sql` | Untriaged; do not promote without catalog review |
| `20261111120000` | `supabase/migrations/20261111120000_reverse_failed_refund_journal.sql` | Untriaged; do not promote without catalog review |
| `20261111130000` | `supabase/migrations/20261111130000_due_settlement_eligibility_scan.sql` | Untriaged; do not promote without catalog review |
| `20261111131000` | `supabase/migrations/20261111131000_schedule_settlement_eligibility_scan.sql` | Untriaged; do not promote without catalog review |
| `20261111140000` | `supabase/migrations/20261111140000_restore_dev_ops_sla_schedule.sql` | Untriaged; do not promote without catalog review |
| `20261111160000` | `supabase/migrations/20261111160000_reviewed_failed_refund_journal_recovery.sql` | Untriaged; do not promote without catalog review |
| `20261111180000` | `supabase/migrations/20261111180000_enforce_claim_retry_grace.sql` | Untriaged; do not promote without catalog review |
| `20261111183000` | `supabase/migrations/20261111183000_failed_refund_journal_ops_issue_binding.sql` | Untriaged; do not promote without catalog review |
| `20261112001443` | `supabase/migrations/20261112001443_money_desk_approval_notice_events.sql` | Untriaged; do not promote without catalog review |
| `20261112010000` | `supabase/migrations/20261112010000_dev_reviewed_tip_refund_reconciliation.sql` | Untriaged; do not promote without catalog review |
| `20261112213000` | `supabase/migrations/20261112213000_schedule_stale_payout_alert_scan.sql` | Untriaged; do not promote without catalog review |
| `20261113010000` | `supabase/migrations/20261113010000_disputed_order_review_case_ownership.sql` | Untriaged; do not promote without catalog review |
| `20261116120000` | `supabase/migrations/20261116120000_tailor_claim_drafts_pr1.sql` | Untriaged; do not promote without catalog review |
| `20261117062555` | `supabase/migrations/20261117062555_harden_tailor_draft_media_ordering.sql` | Untriaged; do not promote without catalog review |
| `20261117151806` | `supabase/migrations/20261117151806_normalize_tailor_draft_price_units.sql` | Untriaged; do not promote without catalog review |
| `20261117164737` | `supabase/migrations/20261117164737_schedule_tailor_draft_purge.sql` | Untriaged; do not promote without catalog review |
| `20261117171105` | `supabase/migrations/20261117171105_fix_public_catalogue_profile_policy.sql` | Untriaged; do not promote without catalog review |
| `20261117172853` | `supabase/migrations/20261117172853_monitor_cron_edge_outcomes.sql` | Untriaged; do not promote without catalog review |
| `20261117202000` | `supabase/migrations/20261117202000_harden_tailor_profile_policy_helpers.sql` | Documented Dev-only; do not promote |
| `20261117203257` | `supabase/migrations/20261117203257_harden_tailor_draft_purge_retries.sql` | Untriaged; do not promote without catalog review |
| `20261117204214` | `supabase/migrations/20261117204214_stage_tailor_profile_private_column_revokes.sql` | Documented Dev-only; do not promote |
| `20261117212042` | `supabase/migrations/20261117212042_add_tailor_claim_email_codes.sql` | Untriaged; do not promote without catalog review |
| `20261117212332` | `supabase/migrations/20261117212332_fix_tailor_claim_email_issue_ambiguity.sql` | Untriaged; do not promote without catalog review |
| `20261117212502` | `supabase/migrations/20261117212502_fix_tailor_claim_email_verify_ambiguity.sql` | Untriaged; do not promote without catalog review |
| `20261117212930` | `supabase/migrations/20261117212930_add_tailor_claim_email_collision_guard.sql` | Untriaged; do not promote without catalog review |
| `20261117213656` | `supabase/migrations/20261117213656_harden_tailor_claim_email_verification.sql` | Untriaged; do not promote without catalog review |
| `20261117225500` | `supabase/migrations/20261117225500_add_tailor_claim_bootstrap_sessions.sql` | Untriaged; do not promote without catalog review |
| `20261118015235` | `supabase/migrations/20261118015235_harden_tailor_claim_request_boundary.sql` | Untriaged; do not promote without catalog review |
| `20261118021045` | `supabase/migrations/20261118021045_add_tailor_claim_provider_bootstrap.sql` | Untriaged; do not promote without catalog review |
| `20261118022134` | `supabase/migrations/20261118022134_stage_tailor_profile_document_and_handoff_revokes.sql` | Documented Dev-only; do not promote |
| `20261118023943` | `supabase/migrations/20261118023943_verify_tailor_claim_provider_before_bootstrap.sql` | Untriaged; do not promote without catalog review |
| `20261118034153` | `supabase/migrations/20261118034153_allow_tailor_claim_provider_retry.sql` | Untriaged; do not promote without catalog review |
| `20261118190130` | `supabase/migrations/20261118190130_add_tailor_claim_transition.sql` | Untriaged; do not promote without catalog review |
| `20261118190140` | `supabase/migrations/20261118190140_add_tailor_claim_finalize.sql` | Untriaged; do not promote without catalog review |
| `20261118190334` | `supabase/migrations/20261118190334_harden_tailor_claim_receipt_policies.sql` | Untriaged; do not promote without catalog review |
| `20261118194515` | `supabase/migrations/20261118194515_recover_interrupted_tailor_claims.sql` | Untriaged; do not promote without catalog review |
| `20261118203934` | `supabase/migrations/20261118203934_protect_tailor_claim_auth_handover.sql` | Untriaged; do not promote without catalog review |
| `20261118212546` | `supabase/migrations/20261118212546_guard_tailor_claim_phone_before_auth.sql` | Untriaged; do not promote without catalog review |
| `20261118220734` | `supabase/migrations/20261118220734_expose_claim_lifecycle_to_tailor_route_guard.sql` | Untriaged; do not promote without catalog review |
| `20261118222734` | `supabase/migrations/20261118222734_prod_forward_pay003_schema.sql` | #235 reviewed forward candidate |
| `20261118223008` | `supabase/migrations/20261118223008_prod_forward_pay003_runtime.sql` | #235 reviewed forward candidate |
| `20261118223016` | `supabase/migrations/20261118223016_prod_forward_pay003_refund_baseline.sql` | #235 reviewed forward candidate |
| `20261118223018` | `supabase/migrations/20261118223018_prod_forward_pay003_hardening.sql` | #235 reviewed forward candidate |
| `20261118223234` | `supabase/migrations/20261118223234_prod_forward_c2_payout_guard.sql` | #235 reviewed forward candidate |
| `20261118223236` | `supabase/migrations/20261118223236_prod_forward_c2_destination_baseline.sql` | #235 reviewed forward candidate |
| `20261118223241` | `supabase/migrations/20261118223241_prod_forward_c2_returned_funds_guard.sql` | #235 reviewed forward candidate |
| `20261119010000` | `supabase/migrations/20261119010000_optional_claim_pickup_postcodes.sql` | Untriaged; do not promote without catalog review |
| `20261119044734` | `supabase/migrations/20261119044734_allow_consumed_tailor_claim_email_code.sql` | Untriaged; do not promote without catalog review |
| `20261122013431` | `supabase/migrations/20261122013431_harden_tailor_claim_provider_cleanup_and_anon_pre_request.sql` | Untriaged; do not promote without catalog review |
| `20261123162913` | `supabase/migrations/20261123162913_revoke_public_security_definer_executes.sql` | Untriaged; do not promote without catalog review |
| `20261123165353` | `supabase/migrations/20261123165353_add_staff_draft_deny_policies_for_payment_tables.sql` | Untriaged; do not promote without catalog review |
| `20261123190000` | `supabase/migrations/20261123190000_order_photo_private_party_read.sql` | Untriaged; do not promote without catalog review |
| `20261123193000` | `supabase/migrations/20261123193000_order_photo_private_evidence_prefixes.sql` | Untriaged; do not promote without catalog review |
| `20261123195000` | `supabase/migrations/20261123195000_make_order_photos_private.sql` | Untriaged; do not promote without catalog review |
| `20261124051110` | `supabase/migrations/20261124051110_revoke_claim_cleanup_execute.sql` | Untriaged; do not promote without catalog review |

The six proposed release units for #235, their preflight gates and postflight checks are in `payments-phase4-progress.md`. Every other row remains outside that approval scope.
