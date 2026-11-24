# Production catalog guard for `main`

Read-only snapshot taken 2026-11-24 from Production `wkfsrunetmgjdtcurmoj`. The scanner at `scripts/phase4-catalog-guard.mjs` inventories every literal `.from('<name>')` and `.rpc('<name>')` in `apps/` and `supabase/functions/`, records each file and line, separates Storage buckets, and compares names with the Production catalog. Run it against the current `main` SHA and a fresh catalog JSON before each release. It reports all 442 distinct referenced names, including 19 absent names in this snapshot. It does not infer dynamic names or prove that a missing routine is reachable, callable, or safe to add.

## Read-only catalog source

Collect sorted distinct table/view names from `pg_class` in `public` and `payment_internal`, routine names from `pg_proc` in those schemas, and bucket IDs from `storage.buckets`. Save only names as JSON keys `tables`, `rpcs`, and `buckets`; no customer rows, function bodies, secrets, or credentials. Run:

```sh
node scripts/phase4-catalog-guard.mjs --root . --catalog /path/to/catalog-names.json > /tmp/catalog-usage.json
```

The JSON lists every name and source site, plus a ranked `missing` subset. `HIGH` means at least one Edge source reference, `MEDIUM` an app runtime reference, and `LOW` only a test/dev reference. Rank is exposure triage, not evidence of an active incident. Payment routes remain disabled. No Production writes were made for this audit.

## Classification of the 19 absent names

Fourteen are **truly missing Production objects** by catalog name, each defined by a source migration that is already assigned to S1–S4 below. Five are **intentionally Dev-only** and must not be promoted to Production. No absent name in this snapshot has evidence of a Production rename or intentional Production drop; those categories have zero confirmed entries. This is name and migration-source classification, not a semantic parity check or an approval to apply the source SQL.

| Rank | Kind | Name | Classification; defining source version; proposed unit |
| --- | --- | --- | --- |
| HIGH | RPC | `apply_reviewed_claimed_payout_retry` | Missing; `20261110130000`; S3 |
| HIGH | RPC | `bind_payout_provider_operation_source_transaction` | Missing; `20261102204053`; S1 |
| HIGH | RPC | `close_unstarted_reviewed_claimed_retry` | Missing; `20261110130000`; S3 |
| HIGH | RPC | `close_unstarted_settlement_tranche_payout` | Missing; `20261110150000`; S3 |
| HIGH | RPC | `complete_reviewed_failed_refund_journal_recovery` | Missing; `20261111160000` (updated by `20261111183000`); S4 |
| HIGH | RPC | `list_due_settlement_eligibility_plans` | Missing; `20261111130000`; S4 |
| HIGH | RPC | `list_due_settlement_eligibility_tranches` | Missing; `20261111130000`; S4 |
| HIGH | RPC | `load_reviewed_claimed_tranche_retry` | Missing; `20261110130000`; S3 |
| HIGH | RPC | `queue_reviewed_dispatch_refund_retry` | Missing; `20261108224000`; S2 |
| HIGH | RPC | `queue_reviewed_fabric_release_recovery` | Missing; `20261102234537`; S2 |
| HIGH | RPC | `reconcile_definite_payout_rejection` | Missing; `20261110140000` (also referenced by `20261102210052`); S3 |
| HIGH | table | `dispatch_refund_retry_operations` | Missing; `20261108224000`; S2 |
| HIGH | table | `payout_claim_retry_authorizations` | Missing; `20261110130000` (tightened by `20261111180000`); S3/S4 |
| MEDIUM | RPC | `bind_dev_ops_mfa_principal` | Dev-only; `20261030133137` / `20261108045200`; exclude |
| MEDIUM | RPC | `complete_dev_reviewed_tip_refund_reconciliation` | Dev-only; `20261112010000`; exclude |
| MEDIUM | RPC | `decide_local_supabase_mfa_money_desk_request` | Dev-only; `20261030133137`; exclude |
| MEDIUM | RPC | `is_dev_ops_mfa_environment` | Dev-only; `20261030133137` / `20261108045200`; exclude |
| MEDIUM | RPC | `issue_local_supabase_mfa_money_desk_grant` | Dev-only; `20261030133137`; exclude |
| MEDIUM | RPC | `list_customer_order_refund_receipts` | Missing; `20261110031000`; S2 |

Before proposing any repair, confirm each routine's full signature and schema, compare the active deployed Edge bundle with `main`, and inspect the exact migration's prerequisites. A name-only miss is a guard signal, not authorization to apply a migration. The customer receipt miss deserves separate investigation even with disabled routes because existing orders can load receipts.
