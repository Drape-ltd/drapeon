# Phase 4 S3 Production migration review draft

Status: **prepare only**. No Production write, provider call, route change, or approval to apply.

| Version | Source effect | Production read-only baseline, 2026-11-25 |
| --- | --- | --- |
| `20261110042832` | Replace tranche source-payment, claim-identity, work-funding, reservation, and finalization functions to allow accounted non-tailor refunds. | Version absent. Existing function bodies need a semantic diff; this is a replacement, not an additive apply. |
| `20261110130000` | Add reviewed payout-claim retry authorization table, service-only validation guards and reservation RPC. | Version and table absent. |
| `20261110140000` | Add definite payout-rejection reconciliation RPC. | Version and named RPC absent. |
| `20261110150000` | Tighten provider-operation identity guard and add close-unstarted-tranche RPC. | Version and new RPC absent; existing guard must be compared. |
| `20261111120000` | Replace failed-refund journal and tranche source-payment functions. | Version and named failed-refund RPC absent; source-payment function may already have a newer body. |

Production currently has **zero enabled payment routes**. The five ledger versions are absent. Those findings do not prove that replacing functions is safe: later migrations may have changed the same bodies. S3 remains held until a Production-shaped local compile, prerequisite/type comparison, and source-to-live function diff identify a forward-only release. In particular, do not replay an old `CREATE OR REPLACE FUNCTION` over a newer live body merely to fill the ledger.

## Read-only preflight to finish before review

Confirm the Production project ref `wkfsrunetmgjdtcurmoj` and environment guard; the five versions absent; UUID/text types for orders, payouts, payment and claim IDs; row counts of payout/refund claims and provider operations; current definitions and EXECUTE grants of every replaced function; absent retry authorization table, indexes, guards and new RPCs; and zero enabled routes. Compare each `pg_get_functiondef` and `pg_get_triggerdef` to source and later merged migrations without publishing customer rows or function secrets.

## Proposed release and postflight

Build new guarded Production-forward SQL for only missing behavior after the comparisons. Rehearse apply and rollback in a Production-shaped disposable database, and reapply against Dev-shaped schema for idempotence. Keep a maximum of five exact versions in the approved batch, each transactionally recorded only when its SQL succeeds; stop at the first error. Do not use broad `db push` or a history-only marker for absent behavior.

After a separately approved release, check exact ledger rows, table RLS and grants, unique constraints, enabled guard triggers, function signatures/search paths/EXECUTE grants, payout/refund claim counts, Advisors, job failure counts, and zero enabled routes. On a mismatch, retain the previous definitions and propose a reviewed forward fix. Never retry a provider payout or refund as a rollback.
