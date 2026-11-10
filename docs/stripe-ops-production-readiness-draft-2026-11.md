# Stripe/Ops Production readiness inventory — draft, no release authorized

Source baseline: merged `main` at `d81f5c598bc7c2160cedcdca7db7af0062f6334a` (#146), including #142 (merge commit `c1d96210e786c03aa9c9ea690c0b0e4fc5736fbc`). This remains a **draft, not a release authorization**. There are 46 source migration versions at or after `20261029000000`; 12 are present in Production and 3 versions are Dev-only, leaving 31 recent-range Production candidates. The separate all-history gap is tracked in open PR #143 and must be reconciled before this becomes the complete release plan. Recompute from the final merge SHA and repeat the full read-only Production preflight immediately before any approved batch. No Production change was made.

## Approved read-only inventory — 2026-11-10 07:42 UTC

The owner approved migration versions, schema/guard and disabled-route checks, and counts plus `EXPLAIN` plans for four backfills. The Production project was verified before querying; its project reference is omitted from this public document. The query returned only migration versions, not customer or provider data:

```sql
select version
from supabase_migrations.schema_migrations
where version >= '20261029000000'
order by version;
```

It returned **exactly these 12 `20261029*` versions before Batch 1**: `20261029000000`, `20261029000500`, `20261029001000`, `20261029001500`, `20261029002000`, `20261029002500`, `20261029003000`, `20261029043814`, `20261029062510`, `20261029063007`, `20261029131928`, `20261029132040`. No `20261030*` or `202611*` source version was present. The earlier draft's 28-candidate count was preliminary and is superseded; it did not consistently exclude the two Dev-only local-MFA receipt migrations and predates later merges. Migration history alone is not schema parity: the catalog check found `snapshot_ready_made_payment_route` still `SECURITY INVOKER`, no provider-refund table or later address-cache/readiness columns, and the older `guard_tranche_claim_source_identity` function bound as an enabled `payout_claims` trigger. `payment_routes` contains **zero rows**, so no route is enabled.

## Post-#142 Production migration-version recheck — 2026-11-10 18:18 UTC

The owner-approved read-only Supabase migration listing returned the same 12 versions above and no later version. #142's Dev rollout did not change Production. This recheck covers migration history only; it does **not** refresh the schema/guard, disabled-route, count, or `EXPLAIN` evidence. Repeat all of those immediately before any Production batch. No Production data or configuration was changed.

## Candidate release units after those 12 versions

Each row is a proposed batch of **at most five** recent-range Production candidates. The three Dev-only versions (`20261030133137`, `20261030151320`, `20261108045200`) are excluded. Rows marked data repair need a Production preview count and `EXPLAIN` before approval. Schema, data repair, security and scheduler work are separate units where source files permit it. A migration that combines those concerns is indivisible; review its complete effects as one unit. Apply only versions confirmed absent in the fresh inventory, preserving dependencies and exact source versions. The owner approves each actual Production release separately. This is not the complete all-history migration set; reconcile it with open PR #143 before any release request.

| Unit | Exact versions | Main concern | Gate before approval |
| --- | --- | --- | --- |
| P01 | `20261029233955` | Narrow ready-made route RPC security | Function ACL, `SECURITY DEFINER`, empty search path |
| P02 | `20261030030000`, `20261030040000` | PAY-003 status and refund-reversal foundation | Local Production-shaped replay and rollback |
| P03 | `20261030050000` | PAY-003 legacy refund backfill | Expected row count and query plan |
| P04 | `20261030060000` | PAY-003 aggregate guard | Refund totals and no duplicate provider-refund rows |
| P05 | `20261030100000` | C2 payout operation transition | Claim/operation guards and grants |
| P06 | `20261030110000` | C2 destination data repair | Expected unambiguous payout count and query plan |
| P07 | `20261030120000` | C2 returned-funds path | No payout route enabled; local replay |
| P08 | `20261030154721` | Stripe payout-readiness writer | Current provider refresh contract |
| P09 | `20261030231747` | Stripe first-release Ops review | Pending/cleared guard and fresh provider evidence |
| P10 | `20261102054500` | First-release block guard | Stale/disabled evidence fails closed |
| P11 | `20261102180324` | Address-scoped tax-cache schema | Cache key and rollback rehearsal |
| P12 | `20261102182653` | Remove legacy ZIP cache rows and enforce address primary key | Expected null-key row count, query plan, rollback; apply immediately after P11 |
| P13 | `20261102200000` | Fabric provider-attempt schema | Columns/indexes and rollback rehearsal |
| P14 | `20261102204053` | Claimed Stripe source-charge binding | Source-charge and destination invariants |
| P15 | `20261102210052`, `20261102234537` | Multiple fabric attempts and reviewed recovery | Local lost-response and replay proof |
| P16 | `20261107194113` | Cancellation-review Money Desk refund | Effective function body and rollback match live Production |
| P17 | `20261108181600` | Push receipt audit | Terminal receipt status and linked Ops alert proof |
| P18 | `20261108224000` | Reviewed dispatch-refund retry | Provider idempotency and terminal attempt proof |
| P19 | `20261108224518` | Worker wake trigger and scheduler | Apply after P18 Edge closure; bounded wake and rollback |
| P20 | `20261109013000` | Canonical cancellation-case finalizer | Live function comparison and idempotent replay |
| P21 | `20261109013500` | Bounded cancellation-case data repair | Expected row count and query plan; zero is valid |
| P22 | `20261110030000` | Money Desk readiness evidence column | Attempt audit and provider-refresh timestamp |
| P23 | `20261110031000` | Customer refund receipt RPC | Customer-only read and no raw Ops note |
| P24 | `20261110042832` | Accounted partial refunds before tranche release | Real-Postgres refund classification and full finalization replay |
| P25 | `20261110050000` | Marketplace category correction | Review category constraints, policies, and affected route behavior; confirm exact Dev migration history first |
| P26 | `20261110120000`, `20261110130000`, `20261110140000` | Reviewed destination correction, claimed-payout retry, and definite-rejection finalization | Apply in order; combined real-Postgres proofs and Dev Stripe TEST recovery with one transfer, balanced ledger, terminal attempts, resolved Ops cases, and replay evidence |
| P27 | `20261110150000` | Close unstarted tranche payout reservations safely | Compare live function/trigger bodies; prove close-to-reviewed-retry and idempotency; classify existing stuck payouts before release approval |

The following unit is **provisional** because its PR is open, not merged. It is not part of the 31-migration recent-range candidate count above. Recompute versions and dependencies after review and merge:

| Open PR | Actual branch migration | Main concern | Gate before Production approval |
| --- | --- | --- | --- |
| #137 `11208190cf7e053edcb727e56ab707a4f7933636` | `20261110173730` | Historical push-outcome data repair | Deploy receipt-aware worker first; fresh affected-row count and `EXPLAIN`, one-to-one receipt match audit, replay and rollback. The PR description still names the old provisional timestamp `20261110084500`; reconcile the description and exact version before merge/release. |

## Current Dev rollout snapshot — read-only, 2026-11-10

The Dev migration listing includes `20261110120000`, `20261110130000`, `20261110140000`, and `20261110150000`, matching the #138–#142 recovery sequence. It does **not** include merged `20261110050000_marketplace_category`; this is an unresolved Dev history/schema gap. Do not apply that older migration blindly after later versions. Inspect its idempotency and live effects, then handle the drift in a separately reviewed Dev step before using Dev as release parity evidence.

The following seven Edge functions are the current source/import closure identified for the regression changes since the #136 baseline. Supabase's read-only Dev inventory returned these versions and bundle digests; the version inventory does not independently attest the source commit for each earlier deployment. Recompute the import closure from the approved release SHA and verify exact deployed digests for every release batch.

| Edge function | Dev version | Dev bundle digest |
| --- | ---: | --- |
| `monitor-settlements` | 57 | `89c5d91bacc3e57bfffd7dff4190df13a28f440adbf2e1e8ffd0e0cd3e7c9ada` |
| `ops-money-action` | 47 | `176fbcc40d6e69bd38ca06c42132df70658a5c300403971bea96e1df1623fe15` |
| `ops-read-gateway` | 36 | `08d433c2a52fb9e6a61a891084f6260632fe11498e00efec77f2197e3e6f73fa` |
| `read-gateway` | 78 | `07dc5a8c54349e27b2762cf26beeec03151d50946a1d0d9b2b4fa97c4538c227` |
| `release-order-tip` | 58 | `231520f610bc43e9b8588b312b50721395c6d31322779618ad8a39ed572e82ac` |
| `release-settlement-tranche` | 65 | `564c32783bd0aeb6434d0dc8c46cbc1fd1712d0a58d6afc70e91508421a15169` |
| `release-tailor-adjustment` | 21 | `d5d8a25cce80ceaf9ad8575c0c2cf930b3265cca55e8959de081654b7995beca` |

For #142, Dev rollout evidence records merge SHA `c1d96210e786c03aa9c9ea690c0b0e4fc5736fbc`, migration `20261110150000`, `release-settlement-tranche` v65, and `monitor-settlements` v57. The settlement monitor has no scheduled cron and was not manually invoked; it must not be enabled until the existing reserved-payout backlog has a reviewed recovery plan. The earlier 19 reservations remain untouched.

**Exclude** `20261108045200_dev_third_mfa_approver.sql` from Production. It exists to add a Dev QA approver. Confirm its migration is absent in Production and never apply it there. Also exclude the Dev-only QA principal seed and any local session configuration.

## Required backfill previews

- **P03:** the current Production count of `order_payments` with `refunded_amount > 0` is **0**. `order_payment_provider_refunds` does not exist until P02, so the exact anti-join and its plan must be rerun after P02 and before P03. The available count plan is a sequential scan of the small payment table; no live customer row qualifies now. The migration inserts one `LEGACY-<payment>` baseline per qualifying payment.
- **P06:** the exact unambiguous destination-repair query returned **0**. Its `EXPLAIN` uses `payouts_destination_settlement_idx` for null destinations, then groups claim/provider-operation evidence; the claim tables are small sequential scans. Recount before P06.
- **P12:** Production `tax_rate_cache` currently has **0** rows. The `address_key` column does not yet exist; P11 creates it. The count plan is a sequential scan of the small cache table. Recount null keys after P11 and before P12's delete/constraint.
- **P21:** the exact case-bound cancellation-repair query returned **0**. Its `EXPLAIN` uses `ops_issues_order_id_idx`, `money_desk_requests_order_idx`, and `ops_job_recoveries_one_pending_idx`, with a small scan of refunded orders. Recount before P21; do not reuse Dev's one-row preview.

For every unit: confirm the exact preflight version set, target project, disabled money routes, affected schema/function definitions, local Production-shaped forward/rollback rehearsal, Dev version and Edge digests, and a bounded postflight. A forward-only or guard-preserving rollback means stopping at that unit and deploying the reviewed code rollback; do not remove durable money guards merely to reverse a version marker. Recompute the Edge import closure from the final merge SHA before each code batch. Production Edge, web, mobile OTA and route enablement have separate approvals; no release is implied by this document.

Open launch gates: upgrade and record the Production ZipTax `request_limit`, alert on real quote failures, genuine courier quote/booking, physical iPhone APNs receipt, Android Preview Firebase app `com.drape.app.preview`, money-event push alert linkage, and the reviewed retry after a definite Stripe transfer rejection. The final A–G evidence and exact Dev Edge versions are still incomplete.
