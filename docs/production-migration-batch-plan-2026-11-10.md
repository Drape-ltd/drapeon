# Stripe/Ops Production migration batch plan — 2026-11

Status: **DRAFT, read-only Production inventory rechecked 2026-11-10 18:18 UTC**. The owner approved the bounded inventory; it authorizes no Production migration, Edge deploy, route enablement, or provider action. Recheck the full live state before each release request. Dev regression A–G remains incomplete.

**Current web/schema skew:** main at `488343e7` includes #145 and #149 after #146, advancing Production web/shared code, while the money migrations and Edge changes in this worksheet remain Dev-only. The #124 reviewed dispatch-refund retry, #129/#132 release-readiness checks, and #138–#142 payout recovery paths must stay unavailable in Production until their compatible schema and Edge code are released under separate approval. Payment routes remain off. #127's local-MFA message is Dev-gated and has no Production login path. Include this skew in every preflight and do not treat a green web deploy as proof of database compatibility.

The companion `docs/stripe-ops-prod-preflight-readonly.sql` contains the history, invariant, backfill, and scheduler read queries. Its syntax was exercised against Dev on 2026-11-09 before the #124 scheduler rollout; the known queued C1 dispatch refund subsequently completed once through the natural Dev wake path, with a 300-cent Stripe TEST refund and replay-safe journal. The owner approved the bounded Production inventory completed on 2026-11-10. A migration-version-only recheck at 18:18 UTC returned the same twelve versions, with no later version; it did not refresh the catalog, disabled-route, backfill-count, or `EXPLAIN` checks. The PAY-003 predicate needed a pre-schema variant because `order_payment_provider_refunds` does not yet exist on Production; the companion SQL now separates that check from the post-schema anti-join.

## Migration-history gate

The repository contains twelve `20261029*` migrations before the proposed PAY-003 batch:

`20261029000000`, `20261029000500`, `20261029001000`, `20261029001500`, `20261029002000`, `20261029002500`, `20261029003000`, `20261029043814`, `20261029062510`, `20261029063007`, `20261029131928`, and `20261029132040`.

The 2026-11-10 read-only Production inventory confirmed **all twelve** exact versions applied and **no migration version later than `20261029132040`**. The 18:18 UTC read-only recheck returned the same twelve. The Phase 3 release record alone had been insufficient. Recheck the pending versions before *each* later batch. A version already present must be excluded; an unknown or generated marker stops the batch.

At main `488343e72255453f9d645d6ccf14451dc5b5fc15`, source contains 689 migration files and the earlier Production history snapshot contains 592 rows, leaving 97 unmatched source versions. This is a planning count until a fresh full-history read confirms the exact set. Within the recent source range beginning `20261029000000`, there are 47 versions: twelve already in Production history and three Dev-only (`20261030133137`, `20261030151320`, `20261108045200`), leaving 32 recent-range Production candidates. The older unmatched range still needs exact-version reconciliation against the Phase 3 supersession record; do not assume a broad date range is safe to replay or to exclude.

The earlier plan's proposed exclusion of 21 September–October Ops/marketing migrations and 43 October claim migrations is **not yet an exact-version exclusion list**. Before Batch 1, compare all older unmatched versions with the reviewed `prod_forward_*` replacements, confirm each functional dependency, and record the exact excluded versions. Do not mark skipped source versions as applied with migration-history repair. The Dev-only MFA and QA-principal versions above remain excluded from Production.

## Candidate order, contingent on the live inventory

Each production batch contains at most five migrations. Schema, data repair, security, and scheduler steps must retain their own review and postflight gates. The Dev-only row below is an exclusion marker, not a production batch. Do not turn this table into one automatic migration push.

| Candidate batch | Exact source versions | Scope and specific preflight |
| --- | --- | --- |
| 1a — PAY-003 security | `20261029233955` | Narrow ready-made snapshot function ownership and grants. Verify owner, search path and service-role-only execute before the payment schema batch. |
| 1b — PAY-003 schema and functions | `20261030030000`, `20261030040000` | Add monotonic payment-status audit/aggregate and refund-reversal logic. Verify objects and five payment-status invariants before the data repair. |
| 1c — PAY-003 backfill | `20261030050000` | Data-only legacy provider-refund baseline. The 2026-11-10 pre-schema Production preview found 0 candidates; its plan was a small sequential scan. Recount under the compatible schema before approval; verify the actual row count and no duplicate provider refund afterward. |
| 1d — PAY-003 hardening | `20261030060000` | Apply the final aggregate/amount guards only after the backfill is reconciled. Re-run all payment/refund invariants. |
| 2a — C2 guards | `20261030100000` | Forward-only payout status and pinned transfer identity. Verify current payout invariants. |
| 2b — C2 backfill | `20261030110000` | Data-only evidenced destination repair. The Production preview found 0 repairable and 0 conflicting rows; its plan aggregated claim destinations and used an indexed payout lookup. Recount before approval; do not infer a destination from current profile state. |
| 2c — C2 returned-funds guard | `20261030120000` | Permit only evidenced returned-transfer terminal failure after the repair. Verify payout and bank-settlement invariants. |
| 3 — excluded Dev-only local-MFA schema | `20261030133137`, `20261030151320` | Do not apply to Production. These receipt schema/trigger migrations are Dev-only by design. |
| 4 — destination readiness | `20261030154721`, `20261030231747`, `20261102054500` | Stripe readiness sync, first-release review, fail-safe block. Recheck provider readiness and routes; keep all payment routes disabled. |
| 5 — address tax cache | `20261102180324`, `20261102182653` | Address-scoped cache followed immediately by its primary-key repair. Production preview found 0 legacy cache rows, with a sequential scan of the empty table. Recount and inspect the delete/upgrade plan before approval; do not deploy tax consumers until both are verified. |
| 6 — fabric payout recovery | `20261102200000`, `20261102204053`, `20261102210052`, `20261102234537` | Provider attempt/source-charge columns, multiple attempts, reviewed recovery. Verify existing payout/operation links and exact grants before Edge deployment. |
| 7 — cancellation refund | `20261107194113` | Reviewed Money Desk cancellation refund. Compare the live function with the rollback body and verify the three earlier repairs remain in the new definition. |
| 8 — push receipt audit | `20261108181600` | Audit push receipt linkage and terminal outcome updates. The Dev QA approver migration and all QA identity data are excluded from Production. |
| 9 — dispatch refund recovery | `20261108224000` | Reviewed failed/canceled refund retry and provider refund ID. #124 merged and this migration was applied to Dev. Count eligible historical runs and verify no duplicate provider refund before Production approval. |
| 10 — worker scheduler | `20261108224518` | **Last**, after the replay-safe refund code, recovery schema, and affected Edge functions are verified. #124 merged and this migration was applied to Dev; the existing $3 job completed once. Inventory Production due/processing jobs by type and oldest age; verify bounded wake and dead-letter rates after any approved release. |
| 11 — cancellation case history | `20261109013000`, `20261109013500` | #126 merged and both migrations were applied to Dev after the #124 refund result. The function closes both case statuses and writes one idempotent state-transition event per case; the bounded repair changed only one proven refunded cancellation review and created no new money or notification jobs. Production preview found 0 repair candidates; its plan used indexed case/Money Desk lookups with an anti-join. Recount before any approval. |
| 12 — reviewed release observation | `20261110030000` | #129's `provider_readiness_checked_at` column on Money Desk attempts. Applied to Dev under the repository version after a Dev history correction. Verify the existing attempt schema and that releases still fail closed when readiness is stale. This column alone does not refresh the legacy executor. |
| 13 — customer refund receipt access | `20261110031000` | #128's customer-scoped refund receipt function and grants. Applied to Dev under the repository version after a Dev history correction. Check function owner, search path, authenticated-only grant, customer isolation and absence of raw provider data. |
| 14 — accounted partial refunds before tranches | `20261110042832` | #131's ledger-backed source-payment gate and related claim/finalization definitions. Applied to Dev under the exact repository version. Compare each live function with its expected predecessor and rollback, prove an unused-delivery refund qualifies while an unjournaled or tailor-share refund fails closed, then check the full post-transfer finalizer. The two Dev-only legacy finalizers deliberately are not in this migration. |
| 15 — marketplace category correction | `20261110050000` | Review category constraints, policies, and affected route behavior. A 2026-11-10 read-only Dev recheck found its exact migration-history version and expected object names; verify definitions and behavior before claiming full Dev parity. |
| 16 — reviewed tranche recovery | `20261110120000`, `20261110130000`, `20261110140000` | #138–#140 destination correction, claimed-payout retry, and definite-rejection finalization. Applied to Dev in order. Require combined real-Postgres proofs and Dev Stripe TEST recovery with one transfer, balanced ledger, terminal attempts, resolved Ops cases, and replay evidence before Production approval. |
| 17 — close unstarted tranche reservations | `20261110150000` | #142 safely closes only proven no-attempt reservations and binds the original charge for reviewed retry. Applied to Dev. Compare live function/trigger bodies, prove close-to-retry and idempotency, and classify existing stuck payouts before release approval. |
| 18 — claimed-payout retry preparation | `20261110160000` | Open draft PR #148 adds the 10-minute grace guard, read projection, Ops preparation UI and `ops-money-action` adapter for a two-person same-destination retry. It is not merged or deployed to Dev. Keep as a separate schema-guard batch; before any Production release require final review/merge, Dev migration and function/web rollout, authenticated Ops visual proof, and a verified prepare-only path that cannot approve or execute. No backfill is proposed. |

The open #137 push-audit PR has actual branch migration `20261110173730` (head `f4ad2c1fdb488922b6bc8fcbac9470af55b648e4`); it is not part of the merged candidate count. Its PR description was corrected to that exact version on 2026-11-10 without changing the head. The historical push-outcome repair requires a fresh Production affected-row count and `EXPLAIN`, receipt-match audit, replay, and rollback. Both CI checks are green on this head, but the latest head still awaits founder re-review and merge.

Open PR #148 is at head `b914a8a013343a5648576b75b1cd737cc4f476c9` and remains a draft. An authenticated Ops browser preview rendered synthetic eligible, grace and existing-review states; Dev had no live eligible candidate, so live preparation and execution remain unverified. Its migration `20261110160000_enforce_claim_retry_grace.sql` is absent from the Dev rollout and is not part of the current deployed-function snapshot. Treat all of its app and Edge changes as proposed until review, merge and Dev proof are complete; all three CI checks and the local Postgres proof are green but do not establish live readiness.

Exclude `20261108045200_dev_third_mfa_approver.sql` from Production. The read-only Production migration inventory does not list it. Also exclude Dev-only QA principal seeds and local session configuration.

## Dev Edge inventory snapshot — 2026-11-10

The Dev inventory below was captured when merged `main` was `d81f5c598bc7c2160cedcdca7db7af0062f6334a` (#146, including #142). A later read-only GitHub check found current `main` at `63ae9cc22dd1073f303fca08b6cfe255b16157d1` after #147; this table is **not** an inventory from that newer commit. These are observed Dev deployments, not an assertion that every function was built from the snapshot SHA. Before a Production Edge release, recompute the exact import closure from the final merged SHA and verify each function's deployment provenance and digest against its Dev proof.

| Function | Dev version | Bundle digest (SHA-256) |
| --- | ---: | --- |
| `custom-order-action` | 120 | `3b30564248d50f6c200915b9bce8307e578152687caa554568e834f68d2dc38f` |
| `customer-order-action` | 162 | `e34b2a826f3863c7aa637cab0d4acc89d105ff35dab1307c039a0b2b10d6857b` |
| `material-advance-action` | 79 | `3a1e05599b2650dd3271c0ab95efd56003c463af850bafe148d9678919e2db8e` |
| `monitor-tax-controls` | 36 | `1c4e4e5dcd4f00e053f82e1dcaf964e3c11b0699a87c0ac19b9b457c53dbe0b8` |
| `ops-dispatch-action` | 3 | `7a47195c28b950a8e29e0f0b32e144c2c6d234c937c00411abf9a0d385ed773e` |
| `ops-money-action` | 47 | `176fbcc40d6e69bd38ca06c42132df70658a5c300403971bea96e1df1623fe15` |
| `ops-read-gateway` | 36 | `08d433c2a52fb9e6a61a891084f6260632fe11498e00efec77f2197e3e6f73fa` |
| `payment-action` | 129 | `5a6a5d09479cc0f3612ddc8df12cd369b815cfdc512342e27d0c03e4df14e344` |
| `payout-account-action` | 102 | `f141b62b48f60ac779598b67ded0b9c95abf15e8ca1d7f170b9dc4c165fd70d1` |
| `process-job-queue` | 133 | `b86986c0218355be0a74624494ccaec3b9dab3336dd8eaf3db7b4c136e7c900f` |
| `process-push-receipts` | 36 | `bcb59b29f0f3d465fe29808a8e376f34e95d91e1e9b3eccacab41f4a8ee78d63` |
| `read-gateway` | 78 | `07dc5a8c54349e27b2762cf26beeec03151d50946a1d0d9b2b4fa97c4538c227` |
| `ready-made-order-action` | 114 | `cc5c3dd203d9c5fec823d75ab0a76e864fc3cf1f299bea3f1f043d17d00252dd` |
| `refund-order-payments` | 84 | `086fbbe902402e333c929e0619d34031a97dc0e7773e8779b9da2607d13d8bed` |
| `release-consultation-earning` | 48 | `33832dee76e68c32848e67f1d746a9a1ea78b3a678c4b3be3daafda0bdee2686` |
| `release-order-payouts` | 104 | `db5fe52e01b9ababf95771c6813c241fa72ba57adcfaf27ae6060a7cad7ecd8b` |
| `release-order-tip` | 58 | `231520f610bc43e9b8588b312b50721395c6d31322779618ad8a39ed572e82ac` |
| `release-settlement-tranche` | 65 | `564c32783bd0aeb6434d0dc8c46cbc1fd1712d0a58d6afc70e91508421a15169` |
| `release-tailor-adjustment` | 21 | `d5d8a25cce80ceaf9ad8575c0c2cf930b3265cca55e8959de081654b7995beca` |
| `monitor-settlements` | 57 | `89c5d91bacc3e57bfffd7dff4190df13a28f440adbf2e1e8ffd0e0cd3e7c9ada` |
| `service-health` | 74 | `45e691b1b91f9a25a32a36453d0b79e2454d448cab8220fe2f1e870044510622` |
| `stripe-webhook` | 166 | `6666231658f555d257bd9c851cc694055caec04e0d9820e875bd497e1bf64bf7` |
| `tailor-order-action` | 191 | `ff6e0b67581c1b260d4d7fded5d4c6fa605bb07ebbf83daf3607b95a138ebc96` |

The read-only Dev inventory also observed `ops-read-gateway` v36 (`08d433c2a52fb9e6a61a891084f6260632fe11498e00efec77f2197e3e6f73fa`).

## Current Dev migration and #142 guard status — read-only, 2026-11-10

The Dev migration listing includes `20261110120000`, `20261110130000`, `20261110140000`, and `20261110150000`, matching the #138–#142 recovery sequence. A subsequent read-only Dev check found exact history version `20261110050000` applied and confirmed the marketplace enum, profile column, decisions table, RPC, guard trigger, and index all exist. This resolves the earlier **missing-version** finding; their live definitions and behavior were not compared in this check, so full Dev release parity remains unproven.

For #142, Dev rollout evidence records merge SHA `c1d96210e786c03aa9c9ea690c0b0e4fc5736fbc`, migration `20261110150000`, `release-settlement-tranche` v65, and `monitor-settlements` v57. The settlement monitor has no scheduled cron and was not manually invoked; it must not be enabled until the existing reserved-payout backlog has a reviewed recovery plan. The earlier 19 reservations remain untouched.

## Rollback and release gates

- Before approval, attach the exact Dev-verified rollback or forward-repair procedure to **each** batch. The repository currently lacks a matching rollback file for Batch 1, Batch 2, Batch 3, and `20261030154721`; these batches are **not release-ready** on rollback evidence alone. Batches 12–17 have committed rollback files, but their Production preconditions and forward-recovery choices still need separate review. Do not improvise a down migration for money rows. A reviewed forward repair may be the safer response after a provider side effect.
- The approved 2026-11-10 Production read found **zero payment-route rows** (therefore zero enabled routes), zero PAY-003 baseline candidates, zero C2 repairable or conflicting payouts, zero address-cache rows, and zero bounded cancellation-case repair candidates. The five PAY-003 payment-status invariants each counted zero. The orphaned dispatch/delivery/communication worker types had no PENDING, RETRYABLE, or PROCESSING rows. These are pre-release observations, not permission to apply migrations or proof that later reads will remain zero.
- Production `EXPLAIN (FORMAT JSON)` showed a small sequential scan for the pre-schema PAY-003 candidate count, a hash aggregation of payout claim destinations followed by an indexed lookup of null-destination payouts for C2, a sequential scan of the empty tax cache, and indexed Ops case/Money Desk lookups with an anti-join for cancellation-case repair. Capture fresh counts and plans before each data batch; the planner's row estimates are not actual repair counts.
- For any data backfill or repair, record the expected row count, conflicting-row count, and `EXPLAIN` plan against Production under separate read-only approval. A count inferred from Dev is insufficient.
- The read-only Dev preview on 2026-11-09 found **0** currently eligible PAY-003 legacy-refund baseline rows and **0** currently repairable or conflicting C2 null-destination payouts. These are post-Dev-migration counts, not Production estimates. The Production preflight must run the predicates from `20261030050000` and `20261030110000` against Production data and retain its own count and plan.
- Dev `EXPLAIN (FORMAT JSON)` for those read-only preflight selections showed a hash anti-join over the small payment/refund tables for PAY-003, and a sorted aggregate of candidate destinations followed by a `payouts_pkey` index lookup for C2. Neither Dev plan is a Production performance claim. Capture the Production plans and row estimates before approving either data migration; a large sequential scan or divergent row count requires a separate rollout review.
- Before every batch: exact project identity, pending-version dry run of no more than five, invariant check, zero enabled payment routes, Dev behavior proof, and explicit owner approval. After every batch: migration history, invariants, advisors, cron/queue health, and route state. Stop on drift.
- Deploy the exact Edge import closure from a reviewed merge SHA only after the compatible schema is live. Record every function's Dev version and digest, then request separate Production Edge approval. The current Dev snapshot includes the release-readiness checks and `read-gateway` projection; it is a verification record, not approval to deploy these functions. Recompute closure against each approved batch and complete the A–G regression first. No mobile OTA or route enablement is bundled with schema or Edge approval.
- Reverse a bad Edge/web build before attempting database rollback. For the address cache pair, fabric recovery, cancellation refund, push audit, and dispatch scheduler, use the committed rollback files only after checking their stated preconditions and provider outcomes. For batches without a committed rollback, obtain a reviewed, specific forward-repair plan first.

Open launch gates include a Production ZipTax plan with enough quota for real quotes and monitoring, real quote-time ZipTax alerts, the reviewed US/TX tax rule chain, a genuine provider dispatch quote/booking pass, and Production review/deployment of the payout recovery migrations and matching Edge code. The C1 dispatch-refund push's final Expo receipt was DEAD / APNs BadDeviceToken on an iOS Dev token even though its queue job was SUCCEEDED; prove terminal delivery and an exact-order tap on a supported physical device before calling notifications verified. Dev `process-push-receipts` v36 also suppresses its aggregate error case behind the routine-case switch and does not link money-event failures. PR #150 at `e3c9c51e` proposes the forward alert path and is green and ready for review, but unmerged and Dev-unverified; a Production Edge rollout and historical-case reconciliation must be separately reviewed. None is satisfied by synthetic Dev evidence.

A read-only Dev projection of #137's grouped repair identifies four newly
`DEAD` historical push outcomes, three of them money events. They are separate
from the four money-event outcomes already `DEAD`, so a later Dev alert repair
must examine seven money-event jobs after #137, with a fresh count and case
deduplication. This is a Dev planning count, not a Production backfill estimate.

## Remaining review work before a release request

This plan is a bounded candidate order, not a release-ready authorization.
Resolve the older exact-version exclusions, the Dev-only generated-history
markers, and the missing rollback or forward-repair procedures before any
batch is proposed for Production approval. Recompute the affected Edge import
closure against the final merged SHA; the Dev version/digest table above is a
snapshot, not final build provenance. The owner must separately approve the
read-only preflight, each migration batch, and each Edge release. No Production
action was taken by this plan.
