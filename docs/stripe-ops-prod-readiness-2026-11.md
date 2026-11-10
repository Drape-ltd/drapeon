# Stripe/Ops Production readiness worksheet — 2026-11

Status: **DRAFT, repository inventory only**. This worksheet authorizes no Production read, migration, Edge deploy, route enablement, or provider action. It must be reconciled against a separately approved, read-only Production migration inventory before any release request. Dev regression A–G remains incomplete.

The companion `docs/stripe-ops-prod-preflight-readonly.sql` contains the exact history, invariant, backfill, and scheduler read queries. Its full multi-statement syntax was exercised against Dev on 2026-11-09 before the #124 scheduler rollout; the final scheduler result then showed the known queued C1 dispatch refund. That job subsequently completed once through the natural Dev wake path, with a 300-cent Stripe TEST refund and replay-safe journal. Run the preflight on Production only after separate owner approval for that read.

## Migration-history gate

The repository contains twelve `20261029*` migrations before the proposed PAY-003 batch:

`20261029000000`, `20261029000500`, `20261029001000`, `20261029001500`, `20261029002000`, `20261029002500`, `20261029003000`, `20261029043814`, `20261029062510`, `20261029063007`, `20261029131928`, and `20261029132040`.

The Phase 3 release record says these were applied, but that historical record is not a current Production inventory. Before Batch 1, obtain owner approval for one read-only Production migration-history check, compare all twelve exact versions with the source files, and record the result privately. Recheck the pending versions before *each* later batch. A version already present must be excluded; an unknown or generated marker stops the batch.

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

## Rollback and release gates

- Before approval, attach the exact Dev-verified rollback or forward-repair procedure to **each** batch. The repository currently lacks a matching rollback file for Batch 1, Batch 2, Batch 3, and `20261030154721`; these batches are **not release-ready** on rollback evidence alone. Do not improvise a down migration for money rows. A reviewed forward repair may be the safer response after a provider side effect.
- For any data backfill or repair, record the expected row count, conflicting-row count, and `EXPLAIN` plan against Production under separate read-only approval. A count inferred from Dev is insufficient.
- The read-only Dev preview on 2026-11-09 found **0** currently eligible PAY-003 legacy-refund baseline rows and **0** currently repairable or conflicting C2 null-destination payouts. These are post-Dev-migration counts, not Production estimates. The Production preflight must run the predicates from `20261030050000` and `20261030110000` against Production data and retain its own count and plan.
- Dev `EXPLAIN (FORMAT JSON)` for those read-only preflight selections showed a hash anti-join over the small payment/refund tables for PAY-003, and a sorted aggregate of candidate destinations followed by a `payouts_pkey` index lookup for C2. Neither Dev plan is a Production performance claim. Capture the Production plans and row estimates before approving either data migration; a large sequential scan or divergent row count requires a separate rollout review.
- Before every batch: exact project identity, pending-version dry run of no more than five, invariant check, zero enabled payment routes, Dev behavior proof, and explicit owner approval. After every batch: migration history, invariants, advisors, cron/queue health, and route state. Stop on drift.
- Deploy the exact Edge import closure from a reviewed merge SHA only after the compatible schema is live. Record every function's Dev version and digest, then request separate Production Edge approval. The #124 Dev function versions and digests are in `docs/stripe-ops-regression-2026-10.md`; the final list cannot be frozen until the A–G regression is complete. No mobile OTA or route enablement is bundled with schema or Edge approval.
- Reverse a bad Edge/web build before attempting database rollback. For the address cache pair, fabric recovery, cancellation refund, push audit, and dispatch scheduler, use the committed rollback files only after checking their stated preconditions and provider outcomes. For batches without a committed rollback, obtain a reviewed, specific forward-repair plan first.

Open launch gates include a Production ZipTax plan with enough quota for real quotes and monitoring, real quote-time ZipTax alerts, the reviewed US/TX tax rule chain, and a genuine provider dispatch quote/booking pass. None is satisfied by synthetic Dev evidence.
