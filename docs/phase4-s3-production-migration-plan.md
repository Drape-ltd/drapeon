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

### Isolated compile rehearsal — 2026-11-26

The five source definitions compiled in order inside a rollback-only local transaction after adding the exact PAY-003 schema already present in Production to the older rehearsal baseline. The historical `20261110140000` file lacks a final SQL semicolon; a separator was added **between files in the local harness only**, without editing source. All five reached rollback completion and the transaction left no schema changes. This checks SQL compilation, not equivalence with the current Production function bodies or idempotent replay. The replacement-function semantic diff remains a release blocker.

Dev history records all five exact S3 source versions. A read-only Dev catalog
check confirmed the reviewed retry table and close-unstarted-tranche RPC are
present, with zero enabled payment routes. These checks establish Dev object
presence; they do not prove the current function bodies still match each
historical source after later migrations.

**Confirmed source ordering conflict:** repository scan found the already-live
PAY-003/C2 forward set replaces `public.guard_payout_forward_status` in
`20261118223234` and `20261118223241`, after historical S3
`20261110130000`. It also replaces
`public.reconcile_failed_order_payment_refund` in `20261118223008` and
`20261118223018`, after historical S3 `20261111120000`. Replaying either S3
source file would restore an older body over the Production money guards.
Therefore these historical versions must **not** be executed as the S3 release
batch. Separate the missing additive table/RPC effects into a new forward
repair, preserve the current PAY-003/C2 bodies, and decide any history-only
markers only after exact live-definition equivalence is proven. The successful
local source compile is not approval to replay these files.

### Production name-only catalog audit — 2026-11-26

A read-only `pg_proc` check across `public` and `payment_internal` found the
following source S3 functions **absent** in Production:
`payment_internal.tranche_source_payment_available(uuid,uuid,uuid)`,
`validate_payout_claim_retry_authorization()`,
`prevent_payout_claim_retry_authorization_rewrite()`,
`apply_reviewed_claimed_payout_retry(uuid,text,text)`,
`close_unstarted_reviewed_claimed_retry(uuid)`,
`load_reviewed_claimed_tranche_retry(uuid,uuid,text,text,text)`,
`reconcile_definite_payout_rejection(uuid,uuid,jsonb)`, and
`close_unstarted_settlement_tranche_payout(uuid,text,text)`. The named
`payout_claim_retry_authorizations` table is absent. The other S3 function
names exist, including the newer PAY-003/C2 guards, but name presence does
not establish body or grant equivalence. `payout_provider_operations_check`
exists and ten provider-operation triggers are enabled; their definitions
still need comparison. The Production route count remained zero ENABLED.

This supports a new forward migration for the absent table and callable
objects. It does **not** authorize copying source S3 files wholesale: their
`CREATE OR REPLACE FUNCTION` statements would overwrite live functions, and
the source retry migration also drops and recreates the provider-operations
CHECK constraint. The forward unit needs a line-by-line dependency and
privilege review before any Production batch is proposed.

## Read-only preflight to finish before review

Confirm the Production project ref `wkfsrunetmgjdtcurmoj` and environment guard; the five versions absent; UUID/text types for orders, payouts, payment and claim IDs; row counts of payout/refund claims and provider operations; current definitions and EXECUTE grants of every replaced function; absent retry authorization table, indexes, guards and new RPCs; and zero enabled routes. Compare each `pg_get_functiondef` and `pg_get_triggerdef` to source and later merged migrations without publishing customer rows or function secrets.

## Proposed release and postflight

Build new guarded Production-forward SQL for only missing behavior after the comparisons. Rehearse apply and rollback in a Production-shaped disposable database, and reapply against Dev-shaped schema for idempotence. Keep a maximum of five exact versions in the approved batch, each transactionally recorded only when its SQL succeeds; stop at the first error. Do not use broad `db push` or a history-only marker for absent behavior.

After a separately approved release, check exact ledger rows, table RLS and grants, unique constraints, enabled guard triggers, function signatures/search paths/EXECUTE grants, payout/refund claim counts, Advisors, job failure counts, and zero enabled routes. On a mismatch, retain the previous definitions and propose a reviewed forward fix. Never retry a provider payout or refund as a rollback.
