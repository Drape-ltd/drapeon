# Phase 2 production migration-history inventory (refreshed 2026-10-27)

> Inventory and release-planning aid only. **Not an execution order or approval.** On 2026-10-27, the user approved a catalog-only Production inspection limited to target schema objects and grants from the 21 pre-Phase-2 migrations. No application rows, production SQL changes, migrations, Edge deploys, provider changes, or route changes were performed.

## Current evidence

- Branch: `codex/payments-phase2-routing-redesign`; base is merged Phase 1 PR #65 at `0ae6c1f7160e74af9621d07b29e0bf39dba39cd5`.
- Source inventory: 528 versioned files in `supabase/migrations/`.
- Production `wkfsrunetmgjdtcurmoj`: 474 migration-history rows, latest `20261015053444` (`throttle_ops_slack_sla_reminders`).
- Dev `pqptfuqogvrajozfsqzi`: 868 rows, latest `20261027023909` (`phase2_pending_refund_measurement_components`).
- Exact source versions not recorded in Prod: 54 total — 21 before Phase 2 and 33 Phase 2. Rechecked migration names; no same-name alternate version was found in Prod for these 54. Dev lacks exact source versions `20261001120000` and `20261015053444`; the latter is present in Dev under alias `20261015053614` with the same migration name. The 2026-10-27 recheck was migration-history-only; it did not inspect production schema or data.
- A separate user-approved catalog-only query inspected target public-schema relations, columns, constraints, indexes, triggers, target function definitions, and object grants for the 21 older missing source migrations. It did not read application rows. Findings are below; a missing history row does not imply every associated object is absent or that a migration is safe to replay.

## Important dependency and recovery findings

- Static source search found current callers of several older missing-schema features: `communications-action` reads/writes marketing-topic preferences; `ops-trust-exception-action` calls `ops_trust_exception_action`; `process-job-queue` calls `register_ops_job_failure`; `ops-case-action` calls `create_ops_source_case`; and `_shared/ops-queue-page` calls `ops_queue_page`. Therefore the pre-Phase-2 candidates cannot be casually dropped from the reconciliation. These callers do **not** prove whether production has equivalent objects from an unrecorded/manual release.
- None of the 21 pre-Phase-2 source versions has a matching file under `supabase/rollback/`. Each needs a reviewed forward-recovery/backout statement before any production execution.
- All 33 Phase-2 versions have rollback-file counterparts in this branch. Existing local evidence treats `20261026050209` and `20261026165822` as forward-only fixes; their rollback files refuse or avoid restoring the defect. A rollback file’s existence is not itself proof the migration is safely reversible.
- AGENTS.md limits a production batch to five pending migrations, requires exact pending-version identification and Dev-first verification, and treats DB migrations and Edge functions as separate releases. The Phase-2 web code must not merge to `main` until either production schema is safely ordered first or old-schema compatibility is proved; merging auto-deploys web.

## Source migration recovery review: 21 pre-Phase-2 candidates

This is a review of the checked-in SQL. The catalog section below checks the named target objects, but does **not** read or reconcile application data, deployed Edge source, RLS policy expressions, or objects outside this allowlist. Some statements are not safe to replay from migration history alone: before proposing execution, compare exact object definitions/privileges and current callers, then choose forward repair rather than dropping data or restoring stale behavior.

| Version | Source effect / dependency | Recovery posture if present or partially applied |
|---|---|---|
| `20260915133000` | Creates private `survey_responses`, indexes, RLS, and service-role grants. | Retain the table and feedback rows; never use a table-drop rollback. Verify RLS/grants and exact indexes before deciding whether any corrective forward migration is needed. |
| `20260915143000` | Creates `survey_invites` plus scheduling functions/triggers on orders, Ops issues, and payouts. Triggers enqueue durable invitations at runtime. | Preserve invitations and current trigger behavior; no destructive rollback. Compare all trigger/function definitions and grants. A forward disable must not silently delete pending invites or break order/support/payout writes. |
| `20260915150000` | Creates topic-level marketing preferences and an authenticated preference RPC; `communications-action` currently reads/writes this table. | Consent/preferences are durable user choices. Do not drop or reconstruct the table from provider state. Reconcile its schema, RLS, trigger, and RPC before changing the live caller. |
| `20260915153000` | Adds campaign topic column/check constraints/index, recipient-contract functions and trigger, and an Ops RPC. | Keep campaign topic data and the constraints that enforce consent. Reapplication can fail on already-present constraints; inspect exact columns, constraints, trigger, and function grants first. Correct by forward migration, not by removing the topic contract. |
| `20260920100000` | Replaces the new-tailor audience validator and its campaign trigger. | Preserve the explicit-customer-audience guard. If definition differs, install the reviewed forward definition; removing the guard is not an acceptable rollback. |
| `20260920113000` | Replaces the campaign-recipient topic function to use canonical account role and fail closed. | Preserve hardened role lookup; do not roll back to auth-metadata role inference. Compare function body and execute privileges. |
| `20260929160000` | Renames the trust-exception RPC to a private snapshot implementation, revokes it, and installs a service-only refresh wrapper. | **Not replay-safe** if rename already happened. Preserve the protected snapshot and wrapper; compare exact signatures, body, and grants before any apply. Never restore stale authorization by rollback. |
| `20260929161000` | Rewrites the trust-exception RPC profile lookup from UUID equality to text-compatible comparison, guarded by an exact source-fragment check. | **Conditional/non-repeatable.** Run only if the expected prior function definition is present; otherwise stop and inspect. Preserve the compatibility fix. |
| `20260929162000` | Repairs the trust-exception wrapper and conditionally renames the old implementation if the snapshot function is absent. | Intended forward repair; still requires exact function and privilege inspection because it changes a protected Ops RPC. Retain the corrected wrapper and snapshot implementation. |
| `20260929163000` | Sends `NOTIFY pgrst, 'reload schema'`; no durable schema/data object. | Safe to repeat as a cache refresh, but it does not prove the preceding RPC is installed or correct. |
| `20261002130000` | Rewrites the trust exception function's future waiver-method assignment from `CHALLENGE_VIDEO` to `ADMIN_RECRUITMENT_WAIVER`; does not rewrite existing profiles. | **Conditional/non-repeatable.** Apply only if the exact expected old assignment remains. Preserve the explicit waiver distinction; compare the function body and grants. |
| `20261015134548` | Installs the first `ops_queue_page` pagination RPC; current Ops queue code calls this RPC. | No table backfill. Reconcile with the later `20261015155317` definition and preserve the final filter/pagination contract; do not restore an older function under the same signature. |
| `20261015150802` | Replaces the SLA reminder worker function; runtime invocation writes audit/case events and may enqueue Slack reminders. | Do not replay the worker as part of migration recovery. Preserve the bounded/cooldown behavior and historical receipts; fix forward if its live definition is wrong. |
| `20261015150942` | Replaces `apply_ops_case_queue_policy` to avoid counting automatic escalation as a human response. | No migration-time row rewrite. Preserve the SLA semantics; function rollback could change future Ops response clocks, so use a reviewed forward correction. |
| `20261015153213` | Installs `create_ops_source_case`, which writes an Ops issue, action receipt, event, and audit row when called. | Migration itself adds no case rows. Preserve the RPC and its audit trail; later grouped-job migration replaces this same function, so final definition/order matters. |
| `20261015155317` | Replaces `ops_queue_page` with the later Ops-filter parity implementation. | This is the final queue RPC in this sequence. Reconcile the later body and service-role-only grant; do not downgrade to the pagination-only version. |
| `20261015160444` | Creates `ops_job_case_members`, indexes and grouped-job views; installs `register_ops_job_failure` and a later `create_ops_source_case`. | New tables/views may hold durable case-to-job evidence after runtime use. Do not drop them. The later `create_ops_source_case` definition supersedes `20261015153213`; verify the full object/grant set before applying. |
| `20261015161242` | Replaces the security-invoker job-case link view and adds job-health/review RPCs that write Ops receipts/events when invoked. | Preserve review receipts and the `security_invoker` view semantics; do not revert a protected review action without a forward fix and grants check. |
| `20261015165500` | Creates `ops_job_recoveries`, uniqueness/indexes, review/recovery functions, and case/job-queue triggers. | Recovery rows, receipts, events, and queued recovery jobs are durable. Never drop/reset them as rollback. Check for partial objects because several `CREATE` statements are not guarded with `IF NOT EXISTS`; recover forward. |
| `20261015173015` | Narrows the Ops audit-to-Slack trigger to suppress routine internal actions. | No historical outbox rewrite. Preserve audit history and reduced fan-out; rollback risks restoring noisy notifications. |
| `20261015183256` | Further narrows that trigger to keep automated daily-digest escalations out of urgent Slack. | Depends on `20261015173015`; preserve the final predicate. Verify the trigger definition exactly rather than replaying just from a missing history row. |

### Reconciliation consequence

The history difference is not an executable migration queue. Several candidates rename functions, perform exact-text rewrites, add unguarded constraints/tables/views, or replace same-signature functions in sequence. The scoped Production catalog read is recorded next; a separate compatibility check against deployed web/Edge versions is still required. Do not apply candidate batches until that evidence and per-migration recovery plan exist.

Static inspection also confirms `origin/main`'s `communications-action` reads `communication_marketing_topic_preferences` in `PREFERENCES_GET` and calls `set_my_marketing_topic_preference` for topic updates. A topic-query error fails the entire preferences read rather than being treated as an empty preference list. Thus the Sep. 15 topic-preference migration objects are a production compatibility check, not merely a Phase-2 future dependency. The catalog read now confirms these objects are absent in Production; which Edge function version is deployed remains unverified.

## Scoped Production catalog reconciliation — 2026-10-27

- **Target confirmed:** Supabase project `wkfsrunetmgjdtcurmoj` is `Drape-PROD`, status `ACTIVE_HEALTHY`, Postgres 17.6. The only SQL was a single `SELECT` over `pg_catalog` and `information_schema`, filtered to the allowlisted target relation/function names below. No application records, keys, logs, payment rows, or customer/tailor data were queried; no write, migration, or deploy occurred.
- **Relations:** 7 of the 14 allowlisted relation names exist. Present: `communication_campaigns`, `communication_campaign_recipients`, `orders`, `ops_issues`, `ops_audit_logs`, `job_queue`, `payouts`. Absent: `survey_responses`, `survey_invites`, `communication_marketing_topic_preferences`, `ops_job_case_members`, `ops_job_case_links`, `ops_grouped_job_items`, `ops_job_recoveries`.
- **Current-main compatibility concern:** `communication_campaigns` lacks `marketing_topic` and its topic index; the marketing-preference table and `set_my_marketing_topic_preference` RPC are absent. Current-main `communications-action` reads/writes these. If that current function version is deployed, topic-preference access is expected to fail closed. The deployed Edge version was not inspected under this approval; verify it in a separately scoped release check before making a production change.
- **Survey migrations:** `survey_responses`, `survey_invites`, their indexes, and the target survey scheduling/updated-at functions are absent. No survey triggers from these migrations are present on `orders`, `ops_issues`, or `payouts`.
- **Marketing-topic migrations:** the preference table/RPC is absent. `communication_campaigns` has no `marketing_topic` column, topic index, recipient-contract/audience functions, or topic/new-tailor guard triggers. The existing campaign table has RLS enabled; policy expressions were not read in this allowlisted query.
- **Trust-exception migrations:** `ops_trust_exception_action` and its `ops_trust_exception_action_snapshot_v1` implementation exist with the expected signatures. The wrapper has a `service_role` execute grant; the snapshot implementation has no non-owner execute grant. The profile-key text comparison and refresh-wrapper markers match the later source. However, the snapshot still assigns `id_verification_method = 'CHALLENGE_VIDEO'`; source migration `20261002130000_record_recruitment_waiver_method` expects `ADMIN_RECRUITMENT_WAIVER`. This is a **present but stale** function definition, not safe to resolve by replaying the exact-text patch without a reviewed forward repair. The cache-only `NOTIFY pgrst` migration has no durable catalog object and cannot be confirmed from catalog state.
- **Ops queue / grouped failures:** `ops_queue_page` and `create_ops_source_case` are absent. `ops_job_case_members`, both grouped-job views, `ops_issues_active_job_failure_group_idx`, `register_ops_job_failure`, and the recovery table/RPCs/triggers are absent. These migration effects are not present in the catalog.
- **SLA / reminder definitions:** `enqueue_ops_slack_sla_reminders` exists but is not the source version: Production has the older generic reminder loop, not the source's capped three-reminder lifecycle, single escalation, receipt, and digest-only behavior. `apply_ops_case_queue_policy` exists but differs from the source: its first-response condition excludes only `NEW`, not both `NEW` and `ESCALATED`, so an automatic escalation can be recorded as a first response. `get_job_queue_health` and `perform_ops_dead_job_review_action` also exist in older forms; Production marks both `SECURITY DEFINER`, while the source defines them `SECURITY INVOKER`, and the current definitions lack grouped-job-aware link logic. Treat these as stale definitions needing reviewed forward repair, not migration replay by version alone.
- **Slack audit trigger:** `trg_enqueue_ops_slack_audit_event` exists on `ops_audit_logs`, but the live trigger definition has no `WHEN` predicate. The source migrations `20261015173015` and `20261015183256` are therefore not reflected: routine actions and automated daily-digest escalation are not filtered at the trigger as intended. The trigger function remains present; the trigger definition is the mismatch.
- **RLS and grants:** every present target table in this query reports RLS enabled. Catalog grants exist on several existing public tables for `anon`/`authenticated` as well as `service_role`; because RLS policy expressions were outside this approval, this read does not establish effective row access or sign off their safety. Newly intended survey/marketing/grouped-job/recovery objects are absent, so they have no object grants to reconcile.
- **Release consequence:** the 21 migration versions are materially mixed: some absent objects, some objects applied without matching history, and several stale functions/triggers. Do **not** push these files to Production as a batch. First reconcile deployed Edge/web versions and build explicit forward-only repairs for stale live definitions; then make small reviewed batches with compatibility ordering and separate Production approval. The marketing-preference schema absence is a high-priority compatibility check before any current-main web release.

### Per-version catalog result

Presence below is from the single allowlisted catalog snapshot; it does not imply that the corresponding migration-history row exists, and it is not an instruction to replay the original file.

| Version | Production catalog result | Recovery direction |
|---|---|---|
| `20260915133000` | `survey_responses` and both source indexes absent. | Add/recover forward after checking current submit-survey callers; do not use a table-drop rollback. |
| `20260915143000` | `survey_invites`, its indexes, invite/scheduling functions, and the survey triggers on `orders`, `ops_issues`, and `payouts` absent. | Recover the full dependency set together in a reviewed forward migration; preserve any existing survey responses/invites if catalog state changes before execution. |
| `20260915150000` | Marketing-preference table and `set_my_marketing_topic_preference` absent; expected preference index/trigger cannot exist without the table. | High-priority compatibility repair because current-main source calls it; first verify deployed Edge version, then forward-apply schema/RLS/RPC as a scoped release. |
| `20260915153000` | `communication_campaigns.marketing_topic`, its topic index/check, topic functions, and recipient-contract trigger absent. | Add the additive column/constraints and final topic contract forward; inspect real campaign data before any validation/backfill. |
| `20260920100000` | New-tailor audience validator replacement and its trigger absent. | Install the final validator/trigger after campaign-topic prerequisites; do not weaken the explicit-audience guard. |
| `20260920113000` | Hardened `apply_marketing_topic_recipient_contract` replacement absent. | Install only after the earlier recipient contract exists; preserve canonical account-role lookup. |
| `20260929160000` | `ops_trust_exception_action` wrapper and private snapshot implementation exist with expected signatures; wrapper markers match the refresh design. | Do not rename/replay. Preserve the snapshot implementation and wrapper grants; audit the subsequent function definition separately. |
| `20260929161000` | The profile-ID comparison uses the expected text-compatible lookup in the live trust functions. | No repair for this fragment; keep the profile-key compatibility behavior in any forward rewrite. |
| `20260929162000` | The refresh wrapper/conditional repair markers are present. | No replay; if a future correction is needed, update forward and retain the service-only wrapper boundary. |
| `20260929163000` | `NOTIFY pgrst` leaves no durable catalog object, so its historical execution cannot be established here. | Reissue a schema-cache notification only as part of an approved schema release when needed; it is not an object-recovery migration. |
| `20261002130000` | Snapshot function still assigns `CHALLENGE_VIDEO`; the final source requires `ADMIN_RECRUITMENT_WAIVER`. | Forward-replace the exact function after source/dependency review; never rewrite any existing profile values as part of this function fix. |
| `20261015134548` | `ops_queue_page` is absent; this is also the final outcome after its later replacement migration. | Recover the final filtered/paginated definition once, not the superseded intermediate implementation. |
| `20261015150802` | `enqueue_ops_slack_sla_reminders` exists but is the older generic loop, not the bounded three-reminder/escalation/digest implementation. | Forward-replace after confirming scheduler callers and current queue-policy columns; keep batch limits and idempotent receipts. |
| `20261015150942` | `apply_ops_case_queue_policy` exists but treats a transition from `NEW` to `ESCALATED` as first response. | Forward-fix the predicate to exclude both `NEW` and `ESCALATED`; preserve legitimate manual first-response behavior. |
| `20261015153213` | `create_ops_source_case` is absent; the later final replacement is absent too. | Recover only the final reviewed function after checking exact role/grant and table dependencies; no source case rows are implied by migration presence. |
| `20261015155317` | Final `ops_queue_page` definition is absent. | Install the final filter-parity/pagination contract; do not restore only the older pagination version. |
| `20261015160444` | `ops_job_case_members`, `ops_job_case_links`, `ops_grouped_job_items`, `ops_issues_active_job_failure_group_idx`, and `register_ops_job_failure` are absent; the final `create_ops_source_case` is also absent. | Add the grouped-job schema/view/index and service-only functions in a dependency-ordered forward batch; preserve historical Ops cases. |
| `20261015161242` | Final grouped-job `ops_job_case_links` view is absent. `get_job_queue_health` and `perform_ops_dead_job_review_action` exist in older `SECURITY DEFINER`, legacy-only forms rather than the source’s invoker/group-aware definitions. | Recover the final security-invoker view/functions and exact grants; do not grant public execution or use the older bodies. |
| `20261015165500` | `ops_job_recoveries`, its indexes, review/recovery functions, and recovery triggers absent. | Add forward only after grouped-job/source-case dependencies; do not attempt a destructive rollback or synthetic recovery rows. |
| `20261015173015` | `trg_enqueue_ops_slack_audit_event` exists but has no trigger `WHEN` condition. | Replace trigger forward with the routine-action filter; retain audit/event history and existing sender function. |
| `20261015183256` | The same trigger still has no condition for routine actions or system `DAILY_DIGEST` escalations. | Install the final combined predicate once, after 20261015173015 behavior is reviewed; do not replay as two competing trigger definitions. |

These recovery directions still require source/dependency checks, Dev rehearsal, exact pending-version planning, and separate approval before any Production execution.

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
