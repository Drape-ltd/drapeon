# Production release log — 2026-11-18 UTC

This is a version record for the approved Track A, privacy, health, and one-time QA privacy repair. Verify live versions before any later Production action; this record is not a substitute for the live inventory.

| Action | Source / authorization | Before | After | Check |
| --- | --- | --- | --- | --- |
| Track A `handle-verification-decision` | `c79ea684`, founder approval | v54 | v55 | No immediate 5xx |
| Track A `ops-trust-action` | `c79ea684`, founder approval | v18 | v19 | No immediate 5xx |
| Track A `ops-read-gateway` | `c79ea684`, founder approval | v18 | v19 | No immediate 5xx |
| Track A `tailor-profile-action` | `c79ea684`, founder approval | v59 | v60 | No immediate 5xx |
| Track A `drape-ops` | `c79ea684`, founder approval | `075a9808` | `d72a7d0f` | Signed-in `/ops/tailors` and placement control rendered |
| `read-gateway` | Excluded from Track A | v45 | v45 | Signed-out Explore remained available |
| `request-data-access` | Merged privacy fix, founder approval | v47 | v48 at 23:08:09 | Function active; live case-routing proof below |
| `request-account-deletion` | Merged privacy fix, founder approval | v50 | v51 at 23:08:23 | Function active |
| `service-health` | Merged tax-scope fix, founder approval | v55 | v56 at 23:22:43 | Public liveness 200; authenticated readiness later checked in run 44428371771 (see below) |
| Migration `20261118235514` | PR #239 at `01603096`, exact-head founder review and explicit admin-merge approval | Absent | Recorded once in Production ledger | Case, receipt, case event, and audit row verified |

PR #239 was admin-merged as `937dc0a29f183cadfea2fbf5bf9a2c1a3885a81f` after its exact-head approval and green CI were checked. Before applying the migration, the Production ledger was reread, and the three relevant actor columns were confirmed nullable (`ops_action_receipts.actor_principal_id`, `ops_case_events.actor_principal_id`, and `ops_audit_logs.performed_by`). The exact migration SQL was applied in one transaction with its exact-version ledger entry; unrelated local migrations were not applied.

`OPS-481417B5` now has `environment = PRODUCTION`, `provenance = QA`, queue `privacy-deletion`, and record version 2. Its `REPAIR_LEGACY_UNKNOWN_PRIVACY_CASE` receipt succeeded, with an `AUDIT_SECURITY` case event and a migration audit row containing the PR approval reference. It remains `NEW`: the current Ops UI and case action API have no audited terminal action for a `DATA_ACCESS_REQUEST`, so it was not closed by direct SQL. `tailor_data_exports` remains `IN_REVIEW`. This needs a normal, audited privacy close path before QA closure.

The remaining open trust cases were reread. The two old Drapeon Test verification cases point to a tailor record that Ops reports unavailable. No unverified Production tailor profile currently has a submitted trust video. No second seller decision was made; a new case must be matched to a live profile and its video before any approval or rejection.

No dead jobs were retried or closed. No seller placement was changed during this log update.

## Explore sections promotion — 2026-11-19 UTC

PRs #236, #241, and #242 were merged in that order after the founder's exact-head reviews. Each stacked PR was retargeted to `main` without changing its reviewed head (`edec960f`, `c62960e1`, `c0d282b0`). The resulting pinned `main` SHA is `9ed3edcfd6a0c6e8b0d755c1a17d69ffc9543a46`.

The manual Production release stopped before its first Edge deployment. Migration `20261118231408` is absent from Dev history, while `AGENTS.md` requires an applied and verified Dev migration before Production promotion. It is also absent from Production history. The Production Edge inventory was read, but no Edge function, migration, Ops Worker, or seller record was changed in this release attempt. The normal `main` web deployment is triggered by the merge and needs a separate live status check; its version is not verified in this record. The requested Production synthetic checks were not run.

The import closure for the changed shared `notify.ts`, `verification-decision.ts`, and `ops-read-projections.ts` spans 15 Edge entrypoints: `auto-release`, `bachs-webhook`, `create-consultation-room`, `create-order-call-room`, `escalate-handoff-issues`, `expire-pending-payments`, `handle-verification-decision`, `handoff-support-action`, `ops-read-gateway`, `payment-action`, `paystack-webhook`, `process-job-queue`, `ready-made-order-action`, `stripe-webhook`, and `studio-order-action`. The founder also named `read-gateway` for this release, outside that import closure. Capture each current source and version and verify its rollback before deploying any of them. Then verify the exact Dev migration and resume the approved release order.

## Service Health and privacy follow-up — 2026-11-19 UTC

The founder confirmed that the 23:08 privacy Edge release (`request-data-access` v48 and `request-account-deletion` v51) and the 23:22 `service-health` v56 release above were intended releases under the earlier approval. They were carried out before this session's context was compacted; no repeat deployment was made while writing this log.

Manual `Drapeon Service Health` run [44428371771](https://github.com/Drape-ltd/drapeon/actions/runs/44428371771) started at 00:21:42 UTC against `main` `937dc0a2`. Production liveness returned 200; Production readiness returned 503. The sole failing Production summary was `jobQueue`: eight dead-lettered jobs need Ops review. The tax-scope check was not reported as failing. The workflow artifact only retained failing summaries, not each passing check's individual result, so this run does not prove their detailed status. Dev readiness also failed for 471 dead-lettered jobs. No jobs were retried or closed.

Read-only investigation found `OPS-5E7CA7EE` and `OPS-865AE39F` both refer to user `3478be20-f74e-474d-8932-fbdc888001d4` and profile `ad013ab8-4760-455d-ac23-c9771886b3d9`. Neither the Production Auth user, public user, tailor profile nor associated handoff exists now. Both are orphaned verification cases; the historical cause of deletion is not established. No seller decision was made, and the cases remain open pending an audited closure action.

`OPS-481417B5` remains an open QA data-access request. Its export `96580d6c-f052-4fd8-ab46-182738646e5b` is `IN_REVIEW` with a generation warning because the deployed export query selects the nonexistent `reviews.content` column. The package must be regenerated, reviewed, released to the authenticated requester and resolved through an audited fulfilment path after a reviewed and verified release. It must not be closed merely as QA.
