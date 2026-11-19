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

Seller one, Flutter by Steff, was approved with receipt `40c139b0-1a29-448b-bba7-11b2b87d5a32` and Explore section `READY_TO_WEAR`. The founder explicitly kept her in Ready-made. Read-only checks before this release found her in the Production `read-gateway` Ready-to-wear response and signed-out web Ready-made Explore. The release preserved that placement; her profile still has no ready-made items.

The remaining open trust cases were reread. The two old Drapeon Test verification cases point to a tailor record that Ops reports unavailable. No unverified Production tailor profile currently has a submitted trust video. No second seller decision was made for these orphaned cases. They must be resolved through a reviewed, audited case action without making a seller decision.

No dead jobs were retried or closed. No seller placement was changed during this log update.

## Explore sections promotion — 2026-11-19 UTC

PRs #236, #241, and #242 were merged in that order after the founder's exact-head reviews. Each stacked PR was retargeted to `main` without changing its reviewed head (`edec960f`, `c62960e1`, `c0d282b0`). The resulting pinned `main` SHA is `9ed3edcfd6a0c6e8b0d755c1a17d69ffc9543a46`.

Migration `20261118231408` was subsequently applied to Drape-DEV in one guarded transaction with its exact history version. The stored statement MD5 (`74ae3cdca383bf68bb906f4c0fbfd97d`) matches the merged SQL; its function and trigger exist. The Dev queue worker was backed up and updated from `main` `9ed3edcf` (v183 → v184). Transactional QA checks passed for Tailors → Ready-made → Tailors, custom-orders-off auto-move, one decision and event per move, two jobs per move, Ops audit, QA case provenance, and first approval with no section-move event; those transactions rolled back. A committed internal QA move cycle left the seller in Tailors and produced two push and two email jobs, all `SUCCEEDED`. Two earlier fixture cycles produced four retryable email jobs: one synthetic Auth fixture was absent from the Auth API, and an `example.com` address was rejected by the email provider. Those Dev jobs were not manually closed or retried.

At the first hold, before the Dev proof, the live-source comparison against `9ed3edcf` found changes outside the Explore scope: the `process-job-queue` bundle differed in `_shared/ops-issues.ts`, shared `ops-issues.ts`, and `_shared/stripe.ts`; the verification handler also differed in shared `ops-issues.ts`; the `read-gateway` bundle differed in both Ops issue files, while its own entrypoint had no change. `ops-read-gateway` differed only in `_shared/ops-read-projections.ts`. The founder subsequently identified the Ops-issues and Stripe changes as reviewed, merged #227 and #212 work. The migration was absent from Production history at that first hold, and the release proceeded only after the Dev proof. The normal `main` web deployment was triggered by the merge; its build version is not independently verified here.

The approved Explore-sections Edge scope was exactly four entrypoints: `process-job-queue`, `handle-verification-decision`, `ops-read-gateway`, and `read-gateway`. The optional, additive `notify.ts` change did not require redeploying its other importers. `auto-release`, `bachs-webhook`, `create-consultation-room`, `create-order-call-room`, `escalate-handoff-issues`, `expire-pending-payments`, `handoff-support-action`, `payment-action`, `paystack-webhook`, `ready-made-order-action`, `stripe-webhook`, and `studio-order-action` were deliberately **not** redeployed in this window. Production rollback sources for the four approved functions were downloaded before promotion.

The pinned `9ed3edcf` Production promotion completed after the Dev proof. Each Edge function was deployed individually, with an immediate HTTP check before the next. Rollback bundles for v60, v55, v19 and v45 were captured first.

| Explore release action | Before | After | Verification |
| --- | --- | --- | --- |
| `process-job-queue` (01:43:17 UTC) | v60 | v61 | Active; unauthenticated GET returned expected 405, no immediate 5xx |
| `handle-verification-decision` (01:43:51 UTC) | v55 | v56 | Active; GET returned 200, no immediate 5xx |
| `ops-read-gateway` (01:44:07 UTC) | v19 | v20 | Active; unauthenticated GET returned expected 401, no immediate 5xx |
| `read-gateway` (01:44:21 UTC) | v45 | v46 | Public Ready-to-wear query returned Flutter; signed-out web Ready-made returned 200 |
| Migration `20261118231408` | Absent from Production ledger | Recorded once | Exact-version SQL and ledger entry in one transaction; RPC and enabled triggers verified |
| `drape-ops` (01:59:09 UTC) | `d72a7d0f` | `dc797db5` | Pinned Ops build and Wrangler dry run passed; signed-in `/ops/tailors` and Flutter's Ready-made placement control rendered without 1101 |

A bounded Production QA transaction moved a test profile to Ready-to-wear and back, observed two domain events and four queued jobs, then rolled back. Its persisted placement remained Tailors. Flutter remained `READY_TO_WEAR` throughout. The public web Ready-made page returned 200 and included Flutter after the release. No payment functions, privacy functions, seller placement, or dead jobs were changed by this promotion.

## Service Health and privacy follow-up — 2026-11-19 UTC

The founder confirmed that the 23:08 privacy Edge release (`request-data-access` v48 and `request-account-deletion` v51) and the 23:22 `service-health` v56 release above were intended releases under the earlier approval. They were carried out before this session's context was compacted; no repeat deployment was made while writing this log.

Manual `Drapeon Service Health` run [44428371771](https://github.com/Drape-ltd/drapeon/actions/runs/44428371771) started at 00:21:42 UTC against `main` `937dc0a2`. Production liveness returned 200; Production readiness returned 503. The sole failing Production summary was `jobQueue`: eight dead-lettered jobs need Ops review. The tax-scope check was not reported as failing. The workflow artifact only retained failing summaries, not each passing check's individual result, so this run does not prove their detailed status. Dev readiness also failed for 471 dead-lettered jobs. No jobs were retried or closed.

Read-only investigation found `OPS-5E7CA7EE` and `OPS-865AE39F` both refer to user `3478be20-f74e-474d-8932-fbdc888001d4` and profile `ad013ab8-4760-455d-ac23-c9771886b3d9`. Neither the Production Auth user, public user, tailor profile nor associated handoff exists now. Both are orphaned verification cases; the historical cause of deletion is not established. No seller decision was made, and the cases remain open pending an audited closure action.

`OPS-481417B5` remains an open QA data-access request. Its export `96580d6c-f052-4fd8-ab46-182738646e5b` is `IN_REVIEW` with a generation warning because the deployed export query selects the nonexistent `reviews.content` column. This P1 bug affects real tailor exports and is tracked in [#248](https://github.com/Drape-ltd/drapeon/issues/248); dedicated fix [#250](https://github.com/Drape-ltd/drapeon/pull/250) and audited fulfilment [#247](https://github.com/Drape-ltd/drapeon/pull/247) must release through the normal reviewed flow. The package must be regenerated, reviewed, released to the authenticated requester and resolved through an audited fulfilment path. It must not be closed merely as QA.
