# Stripe/Ops Production readiness worksheet — 2026-11

Status: **DRAFT, read-only Production inventory recorded 2026-11-10**. The owner approved the bounded inventory; it authorizes no Production migration, Edge deploy, route enablement, or provider action. Recheck the live state before each release request. Dev regression A–G remains incomplete.

**Current web/schema skew:** merges through #133 have advanced Production web/shared code, while the migrations and Edge changes below remain Dev-only. The #124 reviewed dispatch-refund retry must stay unavailable in Production until its schema and compatible Edge code are released under separate approval. #129 added a web-side Stripe readiness refresh and a Dev-only attempt column; #132 added an Edge-side release check that has not been deployed to Production. Payment routes remain off. #127's local-MFA message is Dev-gated and has no Production login path. Include this skew in every preflight and do not treat a green web deploy as proof of database compatibility.

The companion `docs/stripe-ops-prod-preflight-readonly.sql` contains the history, invariant, backfill, and scheduler read queries. Its syntax was exercised against Dev on 2026-11-09 before the #124 scheduler rollout; the known queued C1 dispatch refund subsequently completed once through the natural Dev wake path, with a 300-cent Stripe TEST refund and replay-safe journal. The owner approved the bounded Production inventory completed on 2026-11-10. The PAY-003 predicate needed a pre-schema variant because `order_payment_provider_refunds` does not yet exist on Production; the companion SQL now separates that check from the post-schema anti-join.

## Migration-history gate

The repository contains twelve `20261029*` migrations before the proposed PAY-003 batch:

`20261029000000`, `20261029000500`, `20261029001000`, `20261029001500`, `20261029002000`, `20261029002500`, `20261029003000`, `20261029043814`, `20261029062510`, `20261029063007`, `20261029131928`, and `20261029132040`.

The 2026-11-10 read-only Production inventory confirmed **all twelve** exact versions applied and **no migration version later than `20261029132040`**. The Phase 3 release record alone had been insufficient. Recheck the pending versions before *each* later batch. A version already present must be excluded; an unknown or generated marker stops the batch.

## Candidate order, contingent on the live inventory

Each row contains at most five migrations. These are separate migration files; schema, data repair, security, and scheduler steps must retain their own review and postflight gates. Do not turn this table into one automatic migration push.

| Candidate batch | Exact source versions | Scope and specific preflight |
| --- | --- | --- |
| 1 — PAY-003 | `20261029233955`, `20261030030000`, `20261030040000`, `20261030050000`, `20261030060000` | Ready-made snapshot permissions, forward payment status, refund reversal, legacy refund baseline backfill, aggregate hardening. Count the backfill rows and inspect its plan before approval; verify payment/refund invariants before and after. |
| 2 — C2 | `20261030100000`, `20261030110000`, `20261030120000` | Forward payout states, destination repair, evidenced returned-funds path. Count repairable and conflicting rows before approval; verify payout invariants and bank-settlement behavior after. |
| 3 — local-MFA schema parity | `20261030133137`, `20261030151320` | Apply adjacent, in one batch: the first receipt trigger is broken without the second repair. Never seed a Dev QA principal or enable the Dev-only switch in Production. Verify ordinary Money Desk updates and rejection of local-MFA receipts. |
| 4 — destination readiness | `20261030154721`, `20261030231747`, `20261102054500` | Stripe readiness sync, first-release review, fail-safe block. Recheck provider readiness and routes; keep all payment routes disabled. |
| 5 — address tax cache | `20261102180324`, `20261102182653` | Address-scoped cache followed immediately by its primary-key repair. Count legacy cache rows and inspect the delete/upgrade plan. Do not deploy tax consumers until both are verified. |
| 6 — fabric payout recovery | `20261102200000`, `20261102204053`, `20261102210052`, `20261102234537` | Provider attempt/source-charge columns, multiple attempts, reviewed recovery. Verify existing payout/operation links and exact grants before Edge deployment. |
| 7 — cancellation refund | `20261107194113` | Reviewed Money Desk cancellation refund. Compare the live function with the rollback body and verify the three earlier repairs remain in the new definition. |
| 8 — QA-gated schema and notification audit | `20261108045200`, `20261108181600` | The Dev third-approver function remains unusable without the Dev-only database gate. Audit push receipt linkage and terminal outcome updates. No QA Auth user or enablement row is copied to Production. |
| 9 — dispatch refund recovery | `20261108224000` | Reviewed failed/canceled refund retry and provider refund ID. #124 merged and this migration was applied to Dev. Count eligible historical runs and verify no duplicate provider refund before Production approval. |
| 10 — worker scheduler | `20261108224518` | **Last**, after the replay-safe refund code, recovery schema, and affected Edge functions are verified. #124 merged and this migration was applied to Dev; the existing $3 job completed once. Inventory Production due/processing jobs by type and oldest age; verify bounded wake and dead-letter rates after any approved release. |
| 11 — cancellation case history | `20261109013000`, `20261109013500` | #126 merged and both migrations were applied to Dev after the #124 refund result. The function closes both case statuses and writes one idempotent state-transition event per case; the bounded repair changed only one proven refunded cancellation review and created no new money or notification jobs. Preview eligible and conflicting Production rows before any approval. |
| 12 — reviewed release observation | `20261110030000` | #129's `provider_readiness_checked_at` column on Money Desk attempts. Applied to Dev under the repository version after a Dev history correction. Verify the existing attempt schema and that releases still fail closed when readiness is stale. This column alone does not refresh the legacy executor. |
| 13 — customer refund receipt access | `20261110031000` | #128's customer-scoped refund receipt function and grants. Applied to Dev under the repository version after a Dev history correction. Check function owner, search path, authenticated-only grant, customer isolation and absence of raw provider data. |
| 14 — accounted partial refunds before tranches | `20261110042832` | #131's ledger-backed source-payment gate and related claim/finalization definitions. Applied to Dev under the exact repository version. Compare each live function with its expected predecessor and rollback, prove an unused-delivery refund qualifies while an unjournaled or tailor-share refund fails closed, then check the full post-transfer finalizer. The two Dev-only legacy finalizers deliberately are not in this migration. |

## Dev Edge inventory snapshot — 2026-11-10

Remote `main` was `2103d7734e2973ffe1da3934401d2dbc283d70da` when this read-only Dev inventory was taken. These are **observed Dev deployments**, not an assertion that every function was built from that SHA. Before a Production Edge release, recompute the exact import closure from the final merged SHA and verify each function's deployment provenance and digest against its Dev proof.

| Function | Dev version | Bundle digest (SHA-256) |
| --- | ---: | --- |
| `custom-order-action` | 120 | `3b30564248d50f6c200915b9bce8307e578152687caa554568e834f68d2dc38f` |
| `customer-order-action` | 162 | `e34b2a826f3863c7aa637cab0d4acc89d105ff35dab1307c039a0b2b10d6857b` |
| `material-advance-action` | 79 | `3a1e05599b2650dd3271c0ab95efd56003c463af850bafe148d9678919e2db8e` |
| `monitor-tax-controls` | 36 | `1c4e4e5dcd4f00e053f82e1dcaf964e3c11b0699a87c0ac19b9b457c53dbe0b8` |
| `ops-dispatch-action` | 3 | `7a47195c28b950a8e29e0f0b32e144c2c6d234c937c00411abf9a0d385ed773e` |
| `ops-money-action` | 46 | `9d5bec4af2320221702b8361c716e46cbf16bcef19ce583fc39756844975212e` |
| `ops-read-gateway` | 36 | `08d433c2a52fb9e6a61a891084f6260632fe11498e00efec77f2197e3e6f73fa` |
| `payment-action` | 129 | `5a6a5d09479cc0f3612ddc8df12cd369b815cfdc512342e27d0c03e4df14e344` |
| `payout-account-action` | 102 | `f141b62b48f60ac779598b67ded0b9c95abf15e8ca1d7f170b9dc4c165fd70d1` |
| `process-job-queue` | 133 | `b86986c0218355be0a74624494ccaec3b9dab3336dd8eaf3db7b4c136e7c900f` |
| `process-push-receipts` | 36 | `bcb59b29f0f3d465fe29808a8e376f34e95d91e1e9b3eccacab41f4a8ee78d63` |
| `read-gateway` | 76 | `07dc5a8c54349e27b2762cf26beeec03151d50946a1d0d9b2b4fa97c4538c227` |
| `ready-made-order-action` | 114 | `cc5c3dd203d9c5fec823d75ab0a76e864fc3cf1f299bea3f1f043d17d00252dd` |
| `refund-order-payments` | 84 | `086fbbe902402e333c929e0619d34031a97dc0e7773e8779b9da2607d13d8bed` |
| `release-consultation-earning` | 48 | `33832dee76e68c32848e67f1d746a9a1ea78b3a678c4b3be3daafda0bdee2686` |
| `release-order-payouts` | 104 | `db5fe52e01b9ababf95771c6813c241fa72ba57adcfaf27ae6060a7cad7ecd8b` |
| `release-order-tip` | 58 | `231520f610bc43e9b8588b312b50721395c6d31322779618ad8a39ed572e82ac` |
| `release-settlement-tranche` | 63 | `c3a8feeeed4986481e8402ecb845c73e7e12a420022c1ccd9027ccf4d5681403` |
| `release-tailor-adjustment` | 21 | `d5d8a25cce80ceaf9ad8575c0c2cf930b3265cca55e8959de081654b7995beca` |
| `service-health` | 74 | `45e691b1b91f9a25a32a36453d0b79e2454d448cab8220fe2f1e870044510622` |
| `stripe-webhook` | 166 | `6666231658f555d257bd9c851cc694055caec04e0d9820e875bd497e1bf64bf7` |
| `tailor-order-action` | 191 | `ff6e0b67581c1b260d4d7fded5d4c6fa605bb07ebbf83daf3607b95a138ebc96` |

## Rollback and release gates

- Before approval, attach the exact Dev-verified rollback or forward-repair procedure to **each** batch. The repository currently lacks a matching rollback file for Batch 1, Batch 2, Batch 3, and `20261030154721`; these batches are **not release-ready** on rollback evidence alone. Batches 12–14 have committed rollback files, but their Production preconditions and forward-recovery choices still need separate review. Do not improvise a down migration for money rows. A reviewed forward repair may be the safer response after a provider side effect.
- The approved 2026-11-10 Production read found **zero payment-route rows** (therefore zero enabled routes), zero PAY-003 baseline candidates, zero C2 repairable or conflicting payouts, zero address-cache rows, and zero bounded cancellation-case repair candidates. The five PAY-003 payment-status invariants each counted zero. The orphaned dispatch/delivery/communication worker types had no PENDING, RETRYABLE, or PROCESSING rows. These are pre-release observations, not permission to apply migrations or proof that later reads will remain zero.
- Production `EXPLAIN (FORMAT JSON)` showed a small sequential scan for the pre-schema PAY-003 candidate count, a hash aggregation of payout claim destinations followed by an indexed lookup of null-destination payouts for C2, a sequential scan of the empty tax cache, and indexed Ops case/Money Desk lookups with an anti-join for cancellation-case repair. Capture fresh counts and plans before each data batch; the planner's row estimates are not actual repair counts.
- For any data backfill or repair, record the expected row count, conflicting-row count, and `EXPLAIN` plan against Production under separate read-only approval. A count inferred from Dev is insufficient.
- The read-only Dev preview on 2026-11-09 found **0** currently eligible PAY-003 legacy-refund baseline rows and **0** currently repairable or conflicting C2 null-destination payouts. These are post-Dev-migration counts, not Production estimates. The Production preflight must run the predicates from `20261030050000` and `20261030110000` against Production data and retain its own count and plan.
- Dev `EXPLAIN (FORMAT JSON)` for those read-only preflight selections showed a hash anti-join over the small payment/refund tables for PAY-003, and a sorted aggregate of candidate destinations followed by a `payouts_pkey` index lookup for C2. Neither Dev plan is a Production performance claim. Capture the Production plans and row estimates before approving either data migration; a large sequential scan or divergent row count requires a separate rollout review.
- Before every batch: exact project identity, pending-version dry run of no more than five, invariant check, zero enabled payment routes, Dev behavior proof, and explicit owner approval. After every batch: migration history, invariants, advisors, cron/queue health, and route state. Stop on drift.
- Deploy the exact Edge import closure from a reviewed merge SHA only after the compatible schema is live. Record every function's Dev version and digest, then request separate Production Edge approval. The closure must include #132's `release-settlement-tranche` and `release-tailor-adjustment` readiness checks, plus #134's `read-gateway` projection if that PR merges. The #124 Dev function versions and digests are in `docs/stripe-ops-regression-2026-10.md`; the final list cannot be frozen until the A–G regression is complete. No mobile OTA or route enablement is bundled with schema or Edge approval.
- Reverse a bad Edge/web build before attempting database rollback. For the address cache pair, fabric recovery, cancellation refund, push audit, and dispatch scheduler, use the committed rollback files only after checking their stated preconditions and provider outcomes. For batches without a committed rollback, obtain a reviewed, specific forward-repair plan first.

Open launch gates include a Production ZipTax plan with enough quota for real quotes and monitoring, real quote-time ZipTax alerts, the reviewed US/TX tax rule chain, and a genuine provider dispatch quote/booking pass. The C1 dispatch-refund push's final Expo receipt was DEAD / APNs BadDeviceToken on an iOS Dev token even though its queue job was SUCCEEDED; prove terminal delivery and an exact-order tap on a supported physical device before calling notifications verified. None is satisfied by synthetic Dev evidence.
