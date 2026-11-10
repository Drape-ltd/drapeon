# Stripe/Ops Production readiness inventory — draft, no release authorized

Source baseline: merged `main` at `7d62b3231f0ea4d89d13e53f27aa8af2a6174591` (#134). This is a source inventory, **not** a claim that Production has or lacks any version. Recompute from the final merge SHA and obtain a separate, read-only Production migration-history inventory before making a release plan authoritative. No Production query or change was made for this draft.

## Read-only inventory to approve before batching

The Production query should return only migration versions, not customer or provider data:

```sql
select version
from supabase_migrations.schema_migrations
where version >= '20261029000000'
order by version;
```

Compare its exact result with source, including these **12 `20261029*` versions before Batch 1**: `20261029000000`, `20261029000500`, `20261029001000`, `20261029001500`, `20261029002000`, `20261029002500`, `20261029003000`, `20261029043814`, `20261029062510`, `20261029063007`, `20261029131928`, `20261029132040`. Resolve any missing or unexpected version through review; do not infer schema parity from a history row alone. The previous Production release plan records these 12 as applied, but that record is not a fresh inventory.

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

**Exclude** `20261108045200_dev_third_mfa_approver.sql` from Production. It exists to add a Dev QA approver. Confirm its migration is absent in Production and never apply it there. Also exclude the Dev-only QA principal seed and any local session configuration.

## Required backfill previews

- **P03:** count `order_payments` with `refunded_amount > 0` and no `order_payment_provider_refunds` row. The migration inserts one `LEGACY-<payment>` baseline for each candidate, with conflict suppression. Confirm the exact expected count and an index-supported anti-join plan.
- **P06:** count `payouts` with null `provider_destination_id` and exactly one nonblank destination supported by `payout_claims` or `tip_money_operation_claims`. Conflicting evidence is excluded. Confirm the exact count and join/update plan.
- **P13:** count `tax_rate_cache` rows with null `address_key`; the migration deletes them before enforcing the address-scoped primary key. Confirm the exact count, cache quota and rollback approach.
- **P22:** count cancellation `ORDER_REVIEW` cases with a refunded order, a succeeded case-bound Money Desk refund, `status=RESOLVED`, `canonical_status=NEW`, and no pending recovery. Confirm the exact count and joins; do not reuse Dev's one-row preview as the Production expectation.

For every unit: confirm the exact preflight version set, target project, disabled money routes, affected schema/function definitions, local Production-shaped forward/rollback rehearsal, Dev version and Edge digests, and a bounded postflight. A forward-only or guard-preserving rollback means stopping at that unit and deploying the reviewed code rollback; do not remove durable money guards merely to reverse a version marker. Recompute the Edge import closure from the final merge SHA before each code batch. Production Edge, web, mobile OTA and route enablement have separate approvals; no release is implied by this document.

Open launch gates: upgrade and record the Production ZipTax `request_limit`, alert on real quote failures, genuine courier quote/booking, physical iPhone APNs receipt, Android Preview Firebase app `com.drape.app.preview`, money-event push alert linkage, and the reviewed retry after a definite Stripe transfer rejection. The final A–G evidence and exact Dev Edge versions are still incomplete.
