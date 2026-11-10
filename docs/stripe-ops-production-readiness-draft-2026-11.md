# Stripe/Ops Production readiness inventory — draft, no release authorized

Source baseline: merged `main` at `2103d7734e2973ffe1da3934401d2dbc283d70da` (#136). The source migration set is unchanged since #134; #136 changes the mobile earnings display. This remains a **draft, not a release authorization**. Recompute from the final merge SHA and repeat the read-only Production preflight immediately before any approved batch. No Production change was made.

## Approved read-only inventory — 2026-11-10 07:42 UTC

The owner approved migration versions, schema/guard and disabled-route checks, and counts plus `EXPLAIN` plans for four backfills. The Production project was confirmed as `Drape-PROD` (`wkfsrunetmgjdtcurmoj`) before querying. This query returned only migration versions, not customer or provider data:

```sql
select version
from supabase_migrations.schema_migrations
where version >= '20261029000000'
order by version;
```

It returned **exactly these 12 `20261029*` versions before Batch 1**: `20261029000000`, `20261029000500`, `20261029001000`, `20261029001500`, `20261029002000`, `20261029002500`, `20261029003000`, `20261029043814`, `20261029062510`, `20261029063007`, `20261029131928`, `20261029132040`. No `20261030*` or `202611*` source version was present. The source baseline therefore has **28 candidate Production migrations** after those 12, excluding the one Dev-only third-approver migration. Migration history alone is not schema parity: the catalog check found `snapshot_ready_made_payment_route` still `SECURITY INVOKER`, no provider-refund table or later address-cache/readiness columns, and the older `guard_tranche_claim_source_identity` function bound as an enabled `payout_claims` trigger. `payment_routes` contains **zero rows**, so no route is enabled.

## Candidate release units after those 12 versions

Each row is a proposed batch of **at most five** source migrations. Rows marked data repair need a Production preview count and `EXPLAIN` before approval. Schema, data repair, security and scheduler work are separate units where source files permit it. A migration that combines those concerns is indivisible; review its complete effects as one unit. Apply only versions confirmed absent in the fresh inventory, preserving dependencies and exact source versions. The owner approves each actual Production release separately.

| Unit | Exact versions | Main concern | Gate before approval |
| --- | --- | --- | --- |
| P01 | `20261029233955` | Narrow ready-made route RPC security | Function ACL, `SECURITY DEFINER`, empty search path |
| P02 | `20261030030000`, `20261030040000` | PAY-003 status and refund-reversal foundation | Local Production-shaped replay and rollback |
| P03 | `20261030050000` | PAY-003 legacy refund backfill | Expected row count and query plan |
| P04 | `20261030060000` | PAY-003 aggregate guard | Refund totals and no duplicate provider-refund rows |
| P05 | `20261030100000` | C2 payout operation transition | Claim/operation guards and grants |
| P06 | `20261030110000` | C2 destination data repair | Expected unambiguous payout count and query plan |
| P07 | `20261030120000` | C2 returned-funds path | No payout route enabled; local replay |
| P08 | `20261030133137`, `20261030151320` | Local-MFA receipt schema and trigger repair | Apply together; Dev-only identity seed excluded |
| P09 | `20261030154721` | Stripe payout-readiness writer | Current provider refresh contract |
| P10 | `20261030231747` | Stripe first-release Ops review | Pending/cleared guard and fresh provider evidence |
| P11 | `20261102054500` | First-release block guard | Stale/disabled evidence fails closed |
| P12 | `20261102180324` | Address-scoped tax-cache schema | Cache key and rollback rehearsal |
| P13 | `20261102182653` | Remove legacy ZIP cache rows and enforce address primary key | Expected null-key row count, query plan, rollback; apply immediately after P12 |
| P14 | `20261102200000` | Fabric provider-attempt schema | Columns/indexes and rollback rehearsal |
| P15 | `20261102204053` | Claimed Stripe source-charge binding | Source-charge and destination invariants |
| P16 | `20261102210052`, `20261102234537` | Multiple fabric attempts and reviewed recovery | Local lost-response and replay proof |
| P17 | `20261107194113` | Cancellation-review Money Desk refund | Effective function body and rollback match live Production |
| P18 | `20261108181600` | Push receipt audit | Terminal receipt status and linked Ops alert proof |
| P19 | `20261108224000` | Reviewed dispatch-refund retry | Provider idempotency and terminal attempt proof |
| P20 | `20261108224518` | Worker wake trigger and scheduler | Apply after P19 Edge closure; bounded wake and rollback |
| P21 | `20261109013000` | Canonical cancellation-case finalizer | Live function comparison and idempotent replay |
| P22 | `20261109013500` | Bounded cancellation-case data repair | Expected row count and query plan; zero is valid |
| P23 | `20261110030000` | Money Desk readiness evidence column | Attempt audit and provider-refresh timestamp |
| P24 | `20261110031000` | Customer refund receipt RPC | Customer-only read and no raw Ops note |
| P25 | `20261110042832` | Accounted partial refunds before tranche release | Real-Postgres refund classification and full finalization replay |

The following units are **provisional** because their PRs are open, not merged. They are not part of the 28-migration merged-main count above. Recompute versions and dependencies after review and merge:

| Proposed unit | Open PR and version | Main concern | Gate before Production approval |
| --- | --- | --- | --- |
| P26 | #137 `20261110084500` | Historical push-outcome data repair | Deploy receipt-aware worker first; fresh affected-row count and `EXPLAIN`, one-to-one receipt match audit, replay and rollback |
| P27 | #138 `20261110120000` | Reviewed destination correction for a failed claimed tranche | Dev full Money Desk correction through real Postgres and Stripe TEST, with no duplicate transfer; exact guard rollback |
| P28 | #139 `20261110130000` | Reviewed retry after a definite not-sent claimed payout | Apply after P27; re-run combined Postgres proof against merged heads, then prove one real Stripe TEST transfer, ledger release, terminal attempt, notification outcomes and replay on Dev |

**Exclude** `20261108045200_dev_third_mfa_approver.sql` from Production. It exists to add a Dev QA approver. Confirm its migration is absent in Production and never apply it there. Also exclude the Dev-only QA principal seed and any local session configuration.

## Required backfill previews

- **P03:** the current Production count of `order_payments` with `refunded_amount > 0` is **0**. `order_payment_provider_refunds` does not exist until P02, so the exact anti-join and its plan must be rerun after P02 and before P03. The available count plan is a sequential scan of the small payment table; no live customer row qualifies now. The migration inserts one `LEGACY-<payment>` baseline per qualifying payment.
- **P06:** the exact unambiguous destination-repair query returned **0**. Its `EXPLAIN` uses `payouts_destination_settlement_idx` for null destinations, then groups claim/provider-operation evidence; the claim tables are small sequential scans. Recount before P06.
- **P13:** Production `tax_rate_cache` currently has **0** rows. The `address_key` column does not yet exist; after P12 creates it, all old rows would have null keys. The count plan is a sequential scan of the small cache table. Recount null keys after P12 and before the P13 delete/constraint.
- **P22:** the exact case-bound cancellation-repair query returned **0**. Its `EXPLAIN` uses `ops_issues_order_id_idx`, `money_desk_requests_order_idx`, and `ops_job_recoveries_one_pending_idx`, with a small scan of refunded orders. Recount before P22; do not reuse Dev's one-row preview.

For every unit: confirm the exact preflight version set, target project, disabled money routes, affected schema/function definitions, local Production-shaped forward/rollback rehearsal, Dev version and Edge digests, and a bounded postflight. A forward-only or guard-preserving rollback means stopping at that unit and deploying the reviewed code rollback; do not remove durable money guards merely to reverse a version marker. Recompute the Edge import closure from the final merge SHA before each code batch. Production Edge, web, mobile OTA and route enablement have separate approvals; no release is implied by this document.

Open launch gates: upgrade and record the Production ZipTax `request_limit`, alert on real quote failures, genuine courier quote/booking, physical iPhone APNs receipt, Android Preview Firebase app `com.drape.app.preview`, money-event push alert linkage, and the reviewed retry after a definite Stripe transfer rejection. The final A–G evidence and exact Dev Edge versions are still incomplete.
