# Production runtime exposure audit — 2026-11-18

## Boundary and result

This is a **read-only** audit of Drape-PROD (`wkfsrunetmgjdtcurmoj`). It
reconciles the 41 source migrations classified as missing/stale/unprovable in
[the ledger reconciliation](production-migration-ledger-reconciliation-2026-11-17.md)
with the current Production catalog, the source bundles of all 107 active
Production Edge Functions, the web/mobile source at the known deployed web
baseline `e3161712`, and Supabase logs from 2026-11-12 through 2026-11-17.

No application rows, provider records, secrets, migration history markers, or
schema were changed. “Bundle reference” means a deployed function bundle
contains a direct caller or the shared module that invokes the named database
object; it is not proof that every request executes that branch.

The audit found two runtime failures that require forward repair before any
live-money proof:

1. `push_tokens.quarantined_at` is absent. It is not one of the 41 source
   migrations, but it is a required column of the missing
   `20261112003354` push-token contract. Production exhausted one `SEND_PUSH`
   job five times on 2026-11-13 and another five times on 2026-11-17 because
   that column is absent. This is a **P0 notification-path repair**.
2. `public.tailor_claim_invites` is absent. It belongs to the explicitly
   Dev-only `20261116120000` draft-tailor feature, not the 41. The sole
   2026-11-17 missing-relation error was a management audit query
   (`application_name = mgmt-api`, `POST /mcp`), not an Edge function, cron,
   Ops job, or deployed application commit. It is not a customer runtime
   failure and must **not** be promoted as an incidental migration dependency.

Every payment route remains disabled. That lowers immediate checkout exposure,
but it does not make customer cancellation/refund webhooks, Money Desk,
notification jobs, public catalogue queries, or existing provider event
handling unreachable. Live Stripe/Bachs proof and route enablement stay gated
on these repairs.

## Evidence limitations

- Production Edge: all 107 active function sources were retrieved and scanned
  read-only. Named references below are from those deployed bundles.
- Web/mobile: the known live web baseline was `e3161712`; that source was
  searched for direct calls. Most money objects are Edge-only RPCs, so a blank
  web cell does not reduce the Edge-path risk.
- Logs: the matching patterns were `relation … does not exist`, `function …
  does not exist`, and `column … does not exist` over daily, read-only log
  windows.
- Sentry: the Production Sentry monitor ran successfully during the period,
  but `sentry_ops_monitor_state` has no issue seen after 2026-11-11. A direct
  Sentry API query was not available without exposing a monitor credential.
  Therefore **“no Sentry result” is UNVERIFIED, not evidence of no client
  error**. The repair postflights must include the normal Sentry review.

## Missing-source inventory and runtime exposure

Risk is ranked by the reachable path while routes are disabled: **high** =
customer/notification/refund path or money-state guard; **medium** = Ops,
future payout, or customer display with fail-closed behaviour; **low** =
history-only/scheduler/configuration with no current caller found. `—` means
the migration creates no table/function/column/trigger; it may still alter a
policy, index, constraint, or data.

| Source migration | Tables / functions / columns / triggers created or replaced | Deployed dependency (Edge; direct web/mobile when present) | Observed Production error since 11-12 | Risk |
| --- | --- | --- | --- | --- |
| `20261002130000` | —; rewrites trust-exception waiver behaviour | No current deployed token hit | None in Supabase logs; Sentry unverified | Medium — trust/Ops correctness |
| `20261015173015` | Trigger `trg_enqueue_ops_slack_audit_event` | Ops audit/Slack only | None | Low |
| `20261015183256` | Replaces `trg_enqueue_ops_slack_audit_event` condition | Ops audit/Slack only | None | Low |
| `20261022003329` | —; unique TIP business-key index | TIP payout paths use successor claim model | None | High — duplicate-payment guard needs semantic forward proof |
| `20261030030000` | Tables `payment_status_transition_audits`, `order_payment_provider_refunds`, `payment_late_success_refund_operations`; functions `reserve_payment_late_success_refund`, `record_payment_late_success_refund_outcome`, `guard_order_payment_forward_status`, `apply_order_payment_status_transition`, `guard_order_payment_backed_advancement`, `reconcile_failed_order_payment_refund`, `record_confirmed_order_payment_refund`; triggers `order_payment_forward_status_guard`, `order_payment_backed_advancement_guard` | `payment-action`, `expire-pending-payments`, Bachs/Stripe/Paystack webhooks, tips/material/fabric and refund shared modules | No exact function error observed; catalog confirms all listed tables/guards absent | **High** — payment state, late success, cancellation/refund |
| `20261030040000` | Replaces `reconcile_failed_order_payment_refund` | Bachs/Stripe/Paystack refund/webhook recovery | None | **High** — asynchronous refund failure |
| `20261030050000` | —; data-only provider-refund baseline | No direct runtime caller; depends on PAY-003 table | No row evidence read | Medium — separate data backfill only |
| `20261030060000` | Replaces payment/refund guards plus `record_bachs_payment_refund_attempt_outcome` | Bachs/Stripe/Paystack webhook/refund shared modules | None | **High** — provider refund integrity |
| `20261030100000` | `guard_payout_forward_status`, `apply_stripe_transfer_event_to_payout`; trigger `payout_forward_status_guard` | `stripe-webhook` | None | **High** — provider transfer event can arrive despite disabled checkout |
| `20261030110000` | —; payout-destination data repair | No direct runtime caller | No row evidence read | Medium — separate data repair only |
| `20261030120000` | Replaces `guard_payout_forward_status`, `private.sync_returned_snapshot_tranche_payout` | Payout/replacement recovery bundles | None | **High** — returned funds must not regress payout state |
| `20261102180324` | Column `tax_rate_cache.address_key` | `ready-made-order-action`, `tailor-order-action` through tax module | None | **High** — quote/order tax lookup |
| `20261102182653` | —; enforces address-key constraint/PK after data cleanup | Same tax cache | None | Medium — follows schema/data proof |
| `20261102200000` | Column `order_fabric_candidates.provider_attempt_number` | Fabric release, Paystack webhook, job worker | None | High — provider-attempt identity |
| `20261102204053` | Column `payout_provider_operations.provider_source_transaction_id`; functions `prevent_payout_provider_operation_identity_change`, `bind_payout_provider_operation_source_transaction` | `monitor-settlements`, tranche and adjustment releasers | None | **High** — immutable payout source identity |
| `20261102210052` | `reconcile_definite_payout_rejection` | Payout monitor/releasers | None | High — failed-transfer recovery |
| `20261102234537` | `queue_reviewed_fabric_release_recovery` | Money Desk web route and `ops-money-execution` | None | Medium — reviewed fabric recovery |
| `20261108181600` | Column `push_delivery_attempts.notification_job_id`; functions `record_notification_delivery_outcome`, `reconcile_push_notification_outcome`, `sync_push_notification_outcome_trigger`; trigger `sync_push_notification_outcome_on_attempt` | Push notification worker/shared notifier | No exact receipt-link error seen | High — delivery outcome/audit integrity |
| `20261108224000` | Table `dispatch_refund_retry_operations`; column `order_fulfillment_runs.customer_provider_refund_id`; functions `guard_dispatch_refund_retry_operation`, `queue_reviewed_dispatch_refund_retry`; trigger `dispatch_refund_retry_operation_guard` | Customer/tailor order action, dispatch, refund modules, Bachs/Stripe/Paystack flows | None | **High** — customer cancellation/refund retry path |
| `20261108224518` | Functions `wake_money_job_worker`, `wake_due_money_jobs`; trigger `trg_wake_unowned_job_worker` | Durable-job worker | None | Medium — queue recovery; scheduler separate |
| `20261109013500` | —; cancellation-case data repair | No direct runtime caller | No row evidence read | Low — separate data-only review |
| `20261110030000` | Column `money_desk_execution_attempts.provider_readiness_checked_at` | Tranche/adjustment release evidence | None | Medium — Money Desk audit proof |
| `20261110031000` | `list_customer_order_refund_receipts` | Customer web refund records; mobile `CustomerRefundRecordCard` | None | **High** — customer refund visibility |
| `20261110042832` | `tranche_source_payment_available`, `guard_tranche_claim_source_identity`, `require_tranche_work_before_provider`, `reserve_settlement_tranche_payout_row`, `finalize_claimed_route_tranche_release`, `ensure_order_work_funding_source`, `reserve_staged_work_for_payout` | Tranche monitor/releaser; selected current helpers already exist but require body/signature parity proof | None | **High** — staged payout/refund allocation |
| `20261110130000` | Table `payout_claim_retry_authorizations`; column `payout_provider_operations.reviewed_retry_id`; functions `validate_payout_claim_retry_authorization`, `prevent_payout_claim_retry_authorization_rewrite`, `prevent_payout_provider_operation_identity_change`, `apply_reviewed_claimed_payout_retry`, `close_unstarted_reviewed_claimed_retry`, `load_reviewed_claimed_tranche_retry`, `require_matching_payout_correction_operation`, `verify_provider_operation_destination_fingerprints`, `validate_payout_provider_operation_reservation`, `guard_payout_forward_status`, `start_payout_attempt`, `verify_replacement_attempt_identity`, `prepare_replacement_attempt_on_start`; triggers `validate_payout_claim_retry_authorization_before_insert`, `prevent_payout_claim_retry_authorization_rewrite` | Payout monitor, settlement/adjustment releasers; Ops money read projection | None | **High** — replacement payout must remain single-claim |
| `20261110140000` | Replaces `reconcile_definite_payout_rejection` | Payout monitor/releasers | None | High |
| `20261110150000` | Replaces `prevent_payout_provider_operation_identity_change`, `close_unstarted_settlement_tranche_payout` | Claimed tranche failure/release paths | None | High |
| `20261110173730` | —; data-only legacy push delivery/audit reconciliation after receipt linkage exists | No live runtime caller; depends on `notification_job_id` from `20261108181600` | No row evidence read | Low — later, separately reviewed data repair; never resends notifications |
| `20261111120000` | Replaces `reconcile_failed_order_payment_refund`, `tranche_source_payment_available` | Refund + tranche paths | None | **High** — customer refund/payout interaction |
| `20261111130000` | Column `order_settlement_plans.last_eligibility_scan_at`; functions `list_due_settlement_eligibility_tranches`, `list_due_settlement_eligibility_plans` | `monitor-settlements` | None | Medium — alert-only eligibility scan |
| `20261111131000` | —; settlement eligibility cron schedule | Scheduled monitor only | None | Low — scheduler must be isolated |
| `20261111160000` | `complete_reviewed_failed_refund_journal_recovery` | Money Desk recovery | None | Medium — reviewed recovery |
| `20261111180000` | `enforce_payout_claim_retry_grace`; trigger `enforce_payout_claim_retry_grace_before_insert` | Retry reservation path | None | High — late-success safety gap |
| `20261111183000` | Replaces `complete_reviewed_failed_refund_journal_recovery` | Money Desk recovery | None | Medium |
| `20261112001443` | —; expands Money Desk event constraint | Money Desk notification writers | None | Medium — notification/audit event can fail closed |
| `20261112003354` | `push_tokens` columns `expo_project_id`, `app_variant`, `application_id`, `apns_environment`, `token_generation_started_at`, `quarantined_at`, `quarantine_reason`; functions `reset_push_quarantine_on_token_change`, `register_push_token_with_provenance`, `quarantine_repeated_bad_device_token`; trigger `push_tokens_reset_quarantine_on_token_change` | Push registration/notifier, `process-job-queue` | **10 failed SEND_PUSH attempts across two exhausted jobs** (five each); DB reports missing `push_tokens.quarantined_at` | **High / P0** — customer notification jobs dead-letter |
| `20261112213000` | —; stale-payout alert cron schedule | Scheduler only | None | Low — scheduler isolated |
| `20261117171105` | —; public catalogue policy rewrite | Public catalogue/read-gateway path | No matching missing-object log in window | **Superseded for Production** — its recreated predicate compares a UUID order field to text. Use `20261117170000`, which changes only the existing policy target role and does not alter a predicate. |
| `20261117194812` | `get_my_tailor_account_profile` | Not in released web/mobile yet; required before owner-column revokes | None | Medium — security-release prerequisite |
| `20261117202000` | `is_my_tailor_profile`, `is_public_tailor_profile` | Not promoted; source is incompatible with Production because it reads Dev-only `lifecycle_state` | None | **Do not repair by replay** — superseded by `20261118014508` |
| `20261117204214` | —; B0 column revokes | No released native client reads the three columns | None | Medium — staged confidentiality reduction |

## Additional observed runtime exposures outside the 41

| Object | Evidence | Reachable path | Required disposition |
| --- | --- | --- | --- |
| `push_tokens.quarantined_at` | Two notification jobs exhausted five attempts each; `process-job-queue` recorded the missing-column cause | Customer/tailor push notifications | P0 forward schema/function repair; no data deletion or broad reset |
| `public.tailor_claim_invites` | One Production relation-missing error from a management audit request (`mgmt-api`, `POST /mcp`); no deployed Edge function, cron, Ops job, or application commit queried it | Not customer-reachable | Keep the Dev-only feature out of Production. Future audit queries must guard optional tables with `to_regclass(...)` before counting. No schema or runtime repair is needed. |
| `provider_external_account_present`, `auth_user_id`, unqualified `status` | One occurrence each, no linked request/function metadata in the retained log projection | Unknown | Retain as P2 investigation items; do not guess a schema migration or run a repair from these strings. |

## Forward-only repair proposal — no execution

These are **repair blueprints**, not authorisation to create, apply, or mark
any migration. Each new forward migration must be written against the current
Production schema, applied/rehearsed in Dev first, locally rehearsed on a
Production-shaped baseline, and requested in an exact-version batch of no more
than five migrations. Existing historical migration files remain immutable.

| Priority | Proposed isolated batch | Scope (schema / data / scheduler kept separate) | Dry-run before production | Postflight |
| --- | --- | --- | --- | --- |
| P0 | R1 — push notification schema and provenance, 2–3 migrations | **Schema:** add the six push-token columns and constraints; add `notification_job_id`. **Functions/triggers:** quarantine/provenance + receipt reconciliation after schema. No history rewrite. The historical `20261110173730` audit repair is a later, separate data-only proposal; it never resends a notification. | Catalog absence/type check; aggregate counts of non-null/invalid token fields; verify queue/job FK prerequisites. | Send a Dev push receipt through the worker; confirm no missing-column error, outcome reconciliation works, RLS/grants/advisors clean. Production: verify zero new `SEND_PUSH` missing-column failures and alert on any dead job. |
| P1 | R2 — PAY-003 payment/refund guard foundation, 3–4 migrations | **Schema:** three payment/refund audit tables. **Functions:** current forward-compatible state/refund RPCs. **Triggers:** forward-status and order-advancement guards. **Data:** provider-refund baseline is a separate later migration only after a count/amount reconciliation. | Check table/trigger/RPC absence, exact existing payment/refund row counts and statuses, and current Edge call signatures. | Contract cases: late success, duplicate webhook, refund failure; verify idempotency, grants, no transition regression; inspect cancellation/refund queue errors. |
| P1 | R3 — customer dispatch-refund retry guard, 3 migrations | **Schema:** retry table + `customer_provider_refund_id`. **Functions:** reviewed retry reservation. **Trigger:** immutability guard. No provider call. | Check refund/fulfilment row counts and any existing provider-refund ID values; validate current customer/tailor cancellation call signatures. | Refund retry is rejected without approval, then accepted once with approved evidence in Dev; Production cancellation path returns no missing-object error. |
| P1 | R4 — payout identity/retry recovery, up to 5 migrations | Separate schema additions for source-transaction identity and retry authorisations; then compatible reservation/replacement functions; then trigger bindings. The stale-payout/eligibility schedulers stay out. | Verify all claim/attempt table types, empty/current aggregate claim counts, provider-operation states, and exact caller signatures. | Dev provider-success/failure/replacement tests; source identity immutable; one business claim cannot produce concurrent operations; check monitor/releaser logs. |
| P1 | R5 — tax, fabric, tranche/refund allocation runtime, up to 5 migrations | Tax address-key schema/constraint and any required **separate data mapping**; fabric attempt field; current tranche/refund allocation helpers. Do not replay the historical `DELETE` in `20261102182653`. | Check tax-cache rows/address data, fabric candidate counts, existing tranche/refund evidence and helper signatures. | Quote/tax, fabric release and staged refund negative cases pass in Dev; no price or allocation row changed without an approved data migration. |
| P2 | R6 — customer receipts, Money Desk events, reviewed recovery, 3–4 migrations | Receipt RPC, readiness evidence, event-constraint extension and reviewed recovery functions. No payout/provider call. | Verify current event values and receipt source rows; check UI caller projections. | Customer web/mobile refund receipt and Money Desk recovery contract tests pass; no raw DB error surfaced. |
| P2 | R7 — scheduler-only migrations, separate batches | `refresh-settlement-eligibility` and stale-payout alert schedules only, after their functions are live and in alert-only mode. | Inspect existing `cron.job` names, schedule and function health; prove jobs are absent/not duplicated. | Exactly one intended schedule; run once in Dev; Production queue/Slack receives alert-only result, never creates a payout. |
| Security | S1 — #219 staged promotion | Batch 1 has the UUID-safe role-only forward replacement `20261117170000`, the two grant-baseline no-ops, owner RPC and B0a `20261117194900`, which revokes only the two released-client-safe document fields. Batch 2 applies `20261118014508`, then `20261118022149` for `is_test_profile`. `20261117171105`, `20261117202000`, `20261117204214`, and `20261118022134` are excluded from Production. It is independent from money repairs. | Follow the preflight in `docs/tailor-profile-owner-column-security.md`, including every helper column/type and current direct-policy definition. | Owner RPC/public catalogue/B0 projection checks, released mobile compatibility, advisors and disabled-route invariant. |

### Ledger-marker repair is its own later step

The **42 structurally-present versions** in ledger category A are not part of
R1–R7. For each candidate, a read-only catalog fingerprint must establish the
exact final table/column/index/trigger/function definition and dependency
ordering. Only then may a dedicated, reviewed `supabase migration repair
--status applied` request be proposed. Do not use marker repair for data-only,
Dev-only, verification-only, stale-function, or superseded versions;
specifically, `20261117202000` remains excluded and is replaced by
`20261118014508`.

## Security-upgrade overlap

No separate “security upgrade” work has started. The likely overlap is limited
to fixed search paths, trigger/RPC grants, and RLS checks touched by R1–R4 and
S1. Advisor findings must be inventoried in a dedicated worktree after these
repair scopes are approved; they must not be folded into a money-path repair
without a separate review.
