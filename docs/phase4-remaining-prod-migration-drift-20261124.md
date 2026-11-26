# Remaining Production migration drift — read-only catalog audit, 2026-11-24

Compared `origin/main` `86e3bd5768f875fd17a23435dad049253a63d5af` filenames with the linked Production migration ledger (648 recorded versions). This inventory excludes versions already recorded in the ledger, including all seven PAY-003/C2 versions, `20261123162913`, `20261124160643`, `20261124170000`, and the applied tailor-claim Production-forward set. There are **139 remaining absent source markers**.

Working classification: 105 Dev-only or superseded source files; 27 with a catalog effect absent; 7 history-only **candidates**. A present name alone does not prove identical function body, policy, grant, data backfill or scheduler state. No history marker is approved for repair from this table.

Catalog evidence: `pg_class`, `pg_proc`, `pg_trigger`, `information_schema.columns`, `pg_constraint`, `cron.job`, and `storage.buckets` were read only. The old October payment and payout sources were replaced by reviewed forward-only releases, and the older tailor-claim sources by the Production-forward set; they must not be replayed. Important specific checks: `tax_rate_cache.address_key` is absent and its current primary key is `(country_code, postal_code)`; `cron_edge_invocations`, `dispatch_refund_retry_operations`, and `payout_claim_retry_authorizations` are absent; `refresh-settlement-eligibility` and the stale-payout alert cron are absent; `order-photos` is still public; the Money Desk event constraint lacks founder-notice outcomes; 53 historical push outcomes remain unreconciled. The cancellation-case repair has zero currently unresolved candidate rows.

## Exact version inventory

| Version | Source purpose | Classification | Direct catalog evidence |
| --- | --- | --- | --- |
| `20260915133000` | `lifecycle_survey_responses` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20260915143000` | `lifecycle_survey_invite_schedule` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20260915150000` | `marketing_topic_preferences` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20260915153000` | `campaign_topic_binding` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20260920100000` | `guard_new_tailor_drop_audiences` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20260920113000` | `harden_marketing_recipient_role_lookup` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20260929160000` | `refresh_stale_trust_exception` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20260929161000` | `refresh_trust_exception_profile_key_compat` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20260929162000` | `repair_trust_exception_refresh_rpc` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20260929163000` | `reload_postgrest_after_trust_exception_rpc` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261002130000` | `record_recruitment_waiver_method` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261015134548` | `ops_queue_server_pagination` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261015150802` | `cap_ops_sla_reminders` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261015150942` | `preserve_ops_sla_response_on_automatic_escalation` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261015153213` | `ops_source_case_creation` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261015155317` | `ops_queue_filter_parity` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261015160444` | `ops_grouped_job_failures` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261015161242` | `ops_grouped_job_review` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261015165500` | `ops_job_recovery_receipts` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261015173015` | `quiet_routine_ops_slack_events` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261015183256` | `quiet_automatic_ops_sla_escalation_slack` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022002558` | `tip_money_operation_claims` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022002604` | `verify_tip_money_operation_claims` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022002859` | `make_tip_claim_provider_neutral` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022003219` | `harden_tip_claim_outcomes` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022003329` | `unique_tip_payout_business_key` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022003551` | `verify_tip_claim_provider_neutral` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022003554` | `verify_tip_claim_outcomes` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022003557` | `verify_tip_payout_business_key` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022003751` | `payout_claims_and_attempts` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022003811` | `verify_payout_claims_and_attempts` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022003918` | `reserve_payout_claim` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022003952` | `verify_reserve_payout_claim` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022004047` | `start_payout_attempt` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022004111` | `verify_start_payout_attempt` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022004202` | `record_payout_attempt_outcome` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022004233` | `verify_record_payout_attempt_outcome` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022012820` | `finalize_claimed_tip_refund` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022012827` | `verify_finalize_claimed_tip_refund` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022023108` | `block_payout_identity_conflict` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022023327` | `guard_blocked_payout_claim_transition` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022023331` | `verify_blocked_payout_claim_guard` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022023739` | `block_tip_payout_identity_conflict` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022023742` | `verify_blocked_tip_payout_identity_conflict` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022034433` | `require_exact_tip_payout_receipt_for_refund` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022034452` | `verify_exact_tip_payout_receipt_for_refund` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022034759` | `finalize_claimed_stripe_tip_payout` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022035048` | `verify_claimed_stripe_tip_payout` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022035404` | `settle_waiting_tip_refund_after_payout_receipt` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022035500` | `verify_waiting_tip_refund_after_payout_receipt` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022233900` | `reserve_order_payment_refund_claim` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022233922` | `verify_order_payment_refund_claim` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022234256` | `guard_order_payment_refund_claim_identity` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022234319` | `verify_order_payment_refund_claim_identity` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022234942` | `record_order_payment_refund_claim_outcome` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261022235023` | `verify_order_payment_refund_claim_outcome` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261024223431` | `block_confirmed_payout_identity_conflict` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261024223443` | `verify_block_confirmed_payout_identity_conflict` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261024225931` | `block_anomalous_confirmed_payout_conflict` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261024230021` | `verify_anomalous_confirmed_payout_conflict` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261025020517` | `separate_tip_capture_and_payout_ledgers` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261025021016` | `freeze_tip_payout_ledger_receipt` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261025103949` | `verify_tip_payout_ledger_receipt_freeze` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261030030000` | `pay003_forward_only_payment_status` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261030040000` | `pay003_refund_failure_reversal` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261030050000` | `pay003_legacy_refund_baseline` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261030060000` | `pay003_refund_aggregate_hardening` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261030100000` | `c2_forward_only_payouts` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261030110000` | `c2_restore_payout_destinations` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261030120000` | `c2_returned_funds_forward_repair` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261030133137` | `dev_ops_supabase_mfa_identity_receipts` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261030151320` | `repair_local_mfa_receipt_triggers` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261102180324` | `address_scoped_tax_rate_cache` | Truly missing | Absent: column:tax_rate_cache.address_key. |
| `20261102182653` | `enforce_address_scoped_tax_rate_cache_primary_key` | Truly missing | Missing policy, constraint, storage, data backfill or cron; see specific checks above. |
| `20261102200000` | `fabric_release_provider_attempts` | Truly missing | Absent: column:order_fabric_candidates.provider_attempt_number. |
| `20261102204053` | `bind_claimed_stripe_source_charge` | Truly missing | Absent: function:bind_payout_provider_operation_source_transaction, column:payout_provider_operations.provider_source_transaction_id. |
| `20261102210052` | `allow_multiple_fabric_payout_attempts` | Truly missing | Absent: function:reconcile_definite_payout_rejection. |
| `20261102234537` | `reviewed_fabric_release_job_recovery` | Truly missing | Absent: function:queue_reviewed_fabric_release_recovery. |
| `20261107194113` | `cancellation_review_money_desk_refund` | History-only candidate | Named object present: function:finalize_ops_order_cancellation_refund; semantic parity pending. |
| `20261108045200` | `dev_third_mfa_approver` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261108181600` | `push_notification_receipt_audit` | History-only candidate | Named object present: function:record_notification_delivery_outcome, function:reconcile_push_notification_outcome; semantic parity pending. |
| `20261108224000` | `reviewed_dispatch_refund_retry` | Truly missing | Absent: table:dispatch_refund_retry_operations, function:guard_dispatch_refund_retry_operation, function:queue_reviewed_dispatch_refund_retry (+2). |
| `20261108224518` | `orphaned_job_worker_wakeup` | Truly missing | Absent: trigger:trg_wake_unowned_job_worker. |
| `20261109013000` | `cancellation_refund_canonical_case` | History-only candidate | Named object present: function:finalize_ops_order_cancellation_refund; semantic parity pending. |
| `20261109013500` | `repair_cancellation_refund_case_status` | History-only candidate | Effect appears present or no eligible data; semantic parity pending. |
| `20261110030000` | `money_desk_release_readiness_evidence` | Truly missing | Absent: column:money_desk_execution_attempts.provider_readiness_checked_at. |
| `20261110031000` | `customer_refund_receipts` | Dev-only/superseded | Historical text-ID receipt SQL does not compile on Production UUID IDs. Keep this version unrecorded in Production; forward `20261126071500` supplies the UUID-safe receipt RPC. Never include the historical version in a broad push. |
| `20261110042832` | `allow_accounted_non_tailor_refunds_for_tranches` | Truly missing | Absent: function:tranche_source_payment_available. |
| `20261110120000` | `allow_reviewed_tranche_destination_correction` | History-only candidate | Named object present: function:guard_claimed_replacement_against_refund; semantic parity pending. |
| `20261110130000` | `reviewed_claimed_payout_retry` | Truly missing | Absent: table:payout_claim_retry_authorizations, function:validate_payout_claim_retry_authorization, function:prevent_payout_claim_retry_authorization_rewrite (+6). |
| `20261110140000` | `finalise_definite_rejected_tranche` | Truly missing | Absent: function:reconcile_definite_payout_rejection. |
| `20261110150000` | `close_unstarted_tranche_payouts` | Truly missing | Absent: function:close_unstarted_settlement_tranche_payout. |
| `20261110173730` | `reconcile_legacy_push_delivery_audit` | Truly missing | Missing policy, constraint, storage, data backfill or cron; see specific checks above. |
| `20261111120000` | `reverse_failed_refund_journal` | Truly missing | Absent: function:tranche_source_payment_available. |
| `20261111130000` | `due_settlement_eligibility_scan` | Truly missing | Absent: function:list_due_settlement_eligibility_tranches, function:list_due_settlement_eligibility_plans, column:order_settlement_plans.last_eligibility_scan_at. |
| `20261111131000` | `schedule_settlement_eligibility_scan` | Truly missing | Missing policy, constraint, storage, data backfill or cron; see specific checks above. |
| `20261111140000` | `restore_dev_ops_sla_schedule` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261111160000` | `reviewed_failed_refund_journal_recovery` | Truly missing | Absent: function:complete_reviewed_failed_refund_journal_recovery. |
| `20261111180000` | `enforce_claim_retry_grace` | Truly missing | Absent: function:enforce_payout_claim_retry_grace, trigger:enforce_payout_claim_retry_grace_before_insert. |
| `20261111183000` | `failed_refund_journal_ops_issue_binding` | Truly missing | Absent: function:complete_reviewed_failed_refund_journal_recovery. |
| `20261112001443` | `money_desk_approval_notice_events` | Truly missing | Missing policy, constraint, storage, data backfill or cron; see specific checks above. |
| `20261112010000` | `dev_reviewed_tip_refund_reconciliation` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261112213000` | `schedule_stale_payout_alert_scan` | Truly missing | Missing policy, constraint, storage, data backfill or cron; see specific checks above. |
| `20261113010000` | `disputed_order_review_case_ownership` | History-only candidate | Named object present: function:create_ops_source_case; semantic parity pending. |
| `20261116120000` | `tailor_claim_drafts_pr1` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117062555` | `harden_tailor_draft_media_ordering` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117151806` | `normalize_tailor_draft_price_units` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117164737` | `schedule_tailor_draft_purge` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117171105` | `fix_public_catalogue_profile_policy` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117172853` | `monitor_cron_edge_outcomes` | Truly missing | Absent: table:cron_edge_invocations, function:reconcile_cron_edge_outcomes. |
| `20261117202000` | `harden_tailor_profile_policy_helpers` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117203257` | `harden_tailor_draft_purge_retries` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117204214` | `stage_tailor_profile_private_column_revokes` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117212042` | `add_tailor_claim_email_codes` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117212332` | `fix_tailor_claim_email_issue_ambiguity` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117212502` | `fix_tailor_claim_email_verify_ambiguity` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117212930` | `add_tailor_claim_email_collision_guard` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117213656` | `harden_tailor_claim_email_verification` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261117225500` | `add_tailor_claim_bootstrap_sessions` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261118015235` | `harden_tailor_claim_request_boundary` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261118021045` | `add_tailor_claim_provider_bootstrap` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261118022134` | `stage_tailor_profile_document_and_handoff_revokes` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261118023943` | `verify_tailor_claim_provider_before_bootstrap` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261118034153` | `allow_tailor_claim_provider_retry` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261118190130` | `add_tailor_claim_transition` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261118190140` | `add_tailor_claim_finalize` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261118190334` | `harden_tailor_claim_receipt_policies` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261118194515` | `recover_interrupted_tailor_claims` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261118203934` | `protect_tailor_claim_auth_handover` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261118212546` | `guard_tailor_claim_phone_before_auth` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261118220734` | `expose_claim_lifecycle_to_tailor_route_guard` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261119010000` | `optional_claim_pickup_postcodes` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261119044734` | `allow_consumed_tailor_claim_email_code` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261122013431` | `harden_tailor_claim_provider_cleanup_and_anon_pre_request` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261123165353` | `add_staff_draft_deny_policies_for_payment_tables` | Dev-only/superseded | Historical source replaced by forward release, or explicitly Dev-only; do not replay. |
| `20261123190000` | `order_photo_private_party_read` | Truly missing | Missing policy, constraint, storage, data backfill or cron; see specific checks above. |
| `20261123193000` | `order_photo_private_evidence_prefixes` | Truly missing | Missing policy, constraint, storage, data backfill or cron; see specific checks above. |
| `20261123195000` | `make_order_photos_private` | Truly missing | Missing policy, constraint, storage, data backfill or cron; see specific checks above. |
| `20261124051110` | `revoke_claim_cleanup_execute` | History-only candidate | Effect appears present or no eligible data; semantic parity pending. |

## Proposed forward-only repair work units — no approval to execute

These are **source-version references**, not instructions to replay those historical files. Each unit needs a new reviewed Production-forward migration with a Production environment guard, Dev/local rehearsal, exact-version preflight, and separate founder approval. Batches of schema/function changes are distinct from the data backfill and scheduler batches. Preserve dependency order within each unit; do not run a broad `db push`. The exact forward SQL and rollback/roll-forward plan must be reviewed before release.

| Unit | Source versions to reconcile (at most 5) | Preflight / postflight focus |
| --- | --- | --- |
| S1 — tax/fabric foundation | `20261102180324`, `20261102182653`, `20261102200000`, `20261102204053`, `20261102210052` | Check tax cache PK/rows and fabric/provider types; verify columns, PK, RPC signatures, Advisors and disabled routes. |
| S2 — fabric/dispatch/Ops | `20261102234537`, `20261108224000`, `20261108224518`, `20261110030000`, `20261126071500` | Check absent dispatch table, wake trigger and UUID-safe receipts RPC; verify queue wake guard, RLS/grants, Advisors and disabled routes. Historical `20261110031000` remains unrecorded in Production. |
| S3 — payout/refund guards | `20261110042832`, `20261110130000`, `20261110140000`, `20261110150000`, `20261111120000` | Check claim/operation row counts, ID types and absent retry table/functions; verify guards, grants, no new money movement and disabled routes. |
| S4 — settlement/review | `20261111130000`, `20261111160000`, `20261111180000`, `20261111183000`, `20261112001443` | Check absent eligibility/recovery functions and Money Desk constraint; verify RPCs, trigger bindings, notice event codes and Advisors. |
| S5 — cron audit/private media | `20261117172853`; the three old Dev media source versions `20261123190000`, `20261123193000`, `20261123195000` are superseded for Production by guarded forward versions `20261124190000`, `20261124190100`, `20261124190200` in draft #307 | Keep cron audit separate from the private-media release. The media forward set is held until the Dev signed-reader and style-alignment compatibility checks in #307 pass; verify current public bucket, party policies, signed reads, private bucket, cron outcome function and disabled routes. At most four exact versions would be in this unit, but no release is approved. |
| D1 — data backfill only | `20261110173730` | Preview exact historical push candidate count (currently 53) without rows in log; apply an audited forward backfill separately and verify aggregates/no resend. |
| J1 — schedulers only | `20261111131000`, `20261112213000` | Require S4 eligibility function and reviewed alert-only monitor; verify cron names, schedule, bound mode, one run and zero route changes. |

Two additional absent effects require separate scoping before they can be assigned a release unit: the Dev-only staff-draft deny policy (`20261123165353`) belongs to the tailored Production-forward policy catalog, not the old Dev file; and historical cancellation-case data repair (`20261109013500`) currently has zero candidate rows. Neither authorizes a marker repair. The remaining history-only candidates need definition/policy/ACL equality checks before supported `migration repair --status applied` is proposed. No Production write was made.
