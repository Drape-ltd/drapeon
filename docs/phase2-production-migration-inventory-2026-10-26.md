# Phase 2 production migration-history inventory (refreshed 2026-10-27)

> Inventory and release-planning aid only. **Not an execution order, approval, or claim that production schema is missing these objects.** Production was not queried beyond its migration-history endpoint; no production SQL, migration, Edge deploy, provider change, or route change was performed.

## Current evidence

- Branch: `codex/payments-phase2-routing-redesign` at `7679ca46` (refreshed inventory change is documented in the next progress-log entry); base is merged Phase 1 PR #65 at `0ae6c1f7160e74af9621d07b29e0bf39dba39cd5`.
- Source inventory: 528 versioned files in `supabase/migrations/`.
- Production `wkfsrunetmgjdtcurmoj`: 474 migration-history rows, latest `20261015053444` (`throttle_ops_slack_sla_reminders`).
- Dev `pqptfuqogvrajozfsqzi`: 868 rows, latest `20261027023909` (`phase2_pending_refund_measurement_components`).
- Exact source versions not recorded in Prod: 54 total — 21 before Phase 2 and 33 Phase 2. Rechecked migration names; no same-name alternate version was found in Prod for these 54. Dev lacks exact source versions `20261001120000` and `20261015053444`; the latter is present in Dev under alias `20261015053614` with the same migration name. The 2026-10-27 recheck was migration-history-only; it did not inspect production schema or data.

## Important dependency and recovery findings

- Static source search found current callers of several older missing-schema features: `communications-action` reads/writes marketing-topic preferences; `ops-trust-exception-action` calls `ops_trust_exception_action`; `process-job-queue` calls `register_ops_job_failure`; `ops-case-action` calls `create_ops_source_case`; and `_shared/ops-queue-page` calls `ops_queue_page`. Therefore the pre-Phase-2 candidates cannot be casually dropped from the reconciliation. These callers do **not** prove whether production has equivalent objects from an unrecorded/manual release.
- None of the 21 pre-Phase-2 source versions has a matching file under `supabase/rollback/`. Each needs a reviewed forward-recovery/backout statement before any production execution.
- All 33 Phase-2 versions have rollback-file counterparts in this branch. Existing local evidence treats `20261026050209` and `20261026165822` as forward-only fixes; their rollback files refuse or avoid restoring the defect. A rollback file’s existence is not itself proof the migration is safely reversible.
- AGENTS.md limits a production batch to five pending migrations, requires exact pending-version identification and Dev-first verification, and treats DB migrations and Edge functions as separate releases. The Phase-2 web code must not merge to `main` until either production schema is safely ordered first or old-schema compatibility is proved; merging auto-deploys web.

## Timestamp-ordered candidate waves (not approved)

The following groups are mechanical chunks of at most five, split at the pre-Phase-2/Phase-2 boundary. They are **candidates for dependency review**, not an executable production plan. Before any promotion, confirm source parity, dependency order, production web/Edge compatibility, per-migration recovery, dry-run exactness, and the scoped approval.

### PRE-01 — 5 candidate versions

| Version | Source migration | Rollback file |
|---|---|---|
| `20260915133000` | `lifecycle_survey_responses` | none found |
| `20260915143000` | `lifecycle_survey_invite_schedule` | none found |
| `20260915150000` | `marketing_topic_preferences` | none found |
| `20260915153000` | `campaign_topic_binding` | none found |
| `20260920100000` | `guard_new_tailor_drop_audiences` | none found |

### PRE-02 — 5 candidate versions

| Version | Source migration | Rollback file |
|---|---|---|
| `20260920113000` | `harden_marketing_recipient_role_lookup` | none found |
| `20260929160000` | `refresh_stale_trust_exception` | none found |
| `20260929161000` | `refresh_trust_exception_profile_key_compat` | none found |
| `20260929162000` | `repair_trust_exception_refresh_rpc` | none found |
| `20260929163000` | `reload_postgrest_after_trust_exception_rpc` | none found |

### PRE-03 — 5 candidate versions

| Version | Source migration | Rollback file |
|---|---|---|
| `20261002130000` | `record_recruitment_waiver_method` | none found |
| `20261015134548` | `ops_queue_server_pagination` | none found |
| `20261015150802` | `cap_ops_sla_reminders` | none found |
| `20261015150942` | `preserve_ops_sla_response_on_automatic_escalation` | none found |
| `20261015153213` | `ops_source_case_creation` | none found |

### PRE-04 — 5 candidate versions

| Version | Source migration | Rollback file |
|---|---|---|
| `20261015155317` | `ops_queue_filter_parity` | none found |
| `20261015160444` | `ops_grouped_job_failures` | none found |
| `20261015161242` | `ops_grouped_job_review` | none found |
| `20261015165500` | `ops_job_recovery_receipts` | none found |
| `20261015173015` | `quiet_routine_ops_slack_events` | none found |

### PRE-05 — 1 candidate version

| Version | Source migration | Rollback file |
|---|---|---|
| `20261015183256` | `quiet_automatic_ops_sla_escalation_slack` | none found |

### PH2-01 — 5 candidate versions

| Version | Source migration | Rollback file |
|---|---|---|
| `20261026045304` | `prevent_mixed_order_earning_and_tranche_payouts` | present; review before use |
| `20261026045721` | `phase2_route_delivery_country_foundation` | present; review before use |
| `20261026045758` | `accept_order_payment_route_snapshot` | present; review before use |
| `20261026045802` | `snapshot_ready_made_payment_route` | present; review before use |
| `20261026045859` | `ops_payment_route_kill_switch` | present; review before use |

### PH2-02 — 5 candidate versions

| Version | Source migration | Rollback file |
|---|---|---|
| `20261026045903` | `ops_delivery_country_readiness` | present; review before use |
| `20261026045906` | `ops_payment_route_two_person_enablement` | present; review before use |
| `20261026050209` | `fix_ready_made_route_snapshot_legacy_customer_id` | present but forward-only; do not restore defect |
| `20261026060247` | `remove_legacy_currency_map_from_route_acceptance` | present; review before use |
| `20261026060718` | `use_route_provider_for_ready_made_snapshot` | present; review before use |

### PH2-03 — 5 candidate versions

| Version | Source migration | Rollback file |
|---|---|---|
| `20261026064034` | `ops_payment_route_configuration_provisioning` | present; review before use |
| `20261026065628` | `ops_payout_destination_first_withdrawal_review` | present; review before use |
| `20261026065958` | `harden_payout_destination_review_authority` | present; review before use |
| `20261026075107` | `tighten_phase2_service_role_privileges` | present; review before use |
| `20261026075738` | `phase2_read_only_control_plane_tables` | present; review before use |

### PH2-04 — 5 candidate versions

| Version | Source migration | Rollback file |
|---|---|---|
| `20261026110955` | `retire_legacy_currency_provider_function` | present; review before use |
| `20261026144229` | `order_payment_exposure_measurement` | present; review before use |
| `20261026165822` | `fix_phase2_order_exposure_trigger` | present but forward-only; do not restore defect |
| `20261026175146` | `payout_account_movement_measurement` | present; review before use |
| `20261026182919` | `restrict_tax_rate_cache_to_service_role` | present; review before use |

### PH2-05 — 5 candidate versions

| Version | Source migration | Rollback file |
|---|---|---|
| `20261026184350` | `enable_rls_on_ops_queue_policy_tables` | present; review before use |
| `20261026185140` | `phase2_least_privilege_control_plane_grants` | present; review before use |
| `20261026191529` | `payout_purpose_movement_breakdown` | present; review before use |
| `20261026211141` | `payout_transfer_age_measurement` | present; review before use |
| `20261026214558` | `snapshot_funded_fabric_tailoring_earning` | present; review before use |

### PH2-06 — 5 candidate versions

| Version | Source migration | Rollback file |
|---|---|---|
| `20261026214605` | `portable_fabric_allocation_acceptance_lookup` | present; review before use |
| `20261026225514` | `ops_accepted_earning_exposure_summary` | present; review before use |
| `20261027001514` | `consultation_payment_booking_link` | present; review before use |
| `20261027001521` | `consultation_payment_booking_link_backfill` | present; review before use |
| `20261027002755` | `consultation_funded_refund_expense` | present; review before use |

### PH2-07 — 2 candidate versions

| Version | Source migration | Rollback file |
|---|---|---|
| `20261027003748` | `consultation_post_payout_refund_claims` | present; review before use |
| `20261027012510` | `phase2_payment_refund_dispute_components` | present; review before use |

### PH2-08 — 1 candidate version

| Version | Source migration | Rollback file |
|---|---|---|
| `20261027023909` | `phase2_pending_refund_measurement_components` | present; review before use |

## Gate before promotion

1. Reconcile every pre-Phase-2 candidate against current `main`, the Dev migration alias, and the exact production release inventory; do not `db push` the full source folder.
2. Review each candidate SQL file for production locks, data effects, permissions/RLS, existing-object assumptions, and whether the code that calls it is already live. Build forward-recovery instructions where there is no rollback file.
3. Rehearse the exact ordered batches locally and in Dev; verify the route code remains disabled, and run affected checks after each batch.
4. Establish production migration/web ordering. Since `main` deploys web, either migrations must precede merging the web changes under explicit approval, or every affected path must be demonstrated compatible with the pre-migration schema.
5. Obtain the separate, explicit production approval for each release unit. This inventory grants no approval.
