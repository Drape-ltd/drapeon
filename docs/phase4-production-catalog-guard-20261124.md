# Production catalog guard for `main`

Read-only snapshot taken 2026-11-24 from Production `wkfsrunetmgjdtcurmoj`. The scanner at `scripts/phase4-catalog-guard.mjs` inventories every literal `.from('<name>')` and `.rpc('<name>')` in `apps/` and `supabase/functions/`, records each file and line, separates Storage buckets, and compares names with the Production catalog. Run it against the current `main` SHA and a fresh catalog JSON before each release. It reports all 442 distinct referenced names, including 19 absent names in this snapshot. It does not infer dynamic names or prove that a missing routine is reachable, callable, or safe to add.

## Read-only catalog source

Collect sorted distinct table/view names from `pg_class` in `public` and `payment_internal`, routine names from `pg_proc` in those schemas, and bucket IDs from `storage.buckets`. Save only names as JSON keys `tables`, `rpcs`, and `buckets`; no customer rows, function bodies, secrets, or credentials. Run:

```sh
node scripts/phase4-catalog-guard.mjs --root . --catalog /path/to/catalog-names.json > /tmp/catalog-usage.json
```

The JSON lists every name and source site, plus a ranked `missing` subset. `HIGH` means at least one Edge source reference, `MEDIUM` an app runtime reference, and `LOW` only a test/dev reference. Rank is exposure triage, not evidence of an active incident. Payment routes remain disabled. No Production writes were made for this audit.

## Missing names on this snapshot

| Rank | Kind | Name | Source migration or next check |
| --- | --- | --- | --- |
| HIGH | RPC | `apply_reviewed_claimed_payout_retry` | `20261110130000`; reviewed retry path |
| HIGH | RPC | `bind_payout_provider_operation_source_transaction` | `20261102204053`; claimed payout path |
| HIGH | RPC | `close_unstarted_reviewed_claimed_retry` | Check source migration and active retry path |
| HIGH | RPC | `close_unstarted_settlement_tranche_payout` | Check source migration and tranche path |
| HIGH | RPC | `complete_reviewed_failed_refund_journal_recovery` | Check source migration and reviewed refund path |
| HIGH | RPC | `list_due_settlement_eligibility_plans` | Check source migration and monitor scheduler |
| HIGH | RPC | `list_due_settlement_eligibility_tranches` | Check source migration and monitor scheduler |
| HIGH | RPC | `load_reviewed_claimed_tranche_retry` | Check source migration and claimed retry path |
| HIGH | RPC | `queue_reviewed_dispatch_refund_retry` | `20261108224000`; Ops Money Desk path |
| HIGH | RPC | `queue_reviewed_fabric_release_recovery` | Check source migration and Ops path |
| HIGH | RPC | `reconcile_definite_payout_rejection` | Check source migration and payout rejection path |
| HIGH | table | `dispatch_refund_retry_operations` | `20261108224000`; reviewed refund retry |
| HIGH | table | `payout_claim_retry_authorizations` | Check source migration and Ops/read projections |
| MEDIUM | RPC | `bind_dev_ops_mfa_principal` | Dev-only Ops MFA; do not promote automatically |
| MEDIUM | RPC | `complete_dev_reviewed_tip_refund_reconciliation` | Dev-only reconciliation; do not promote automatically |
| MEDIUM | RPC | `decide_local_supabase_mfa_money_desk_request` | Local Dev Money Desk; do not promote automatically |
| MEDIUM | RPC | `is_dev_ops_mfa_environment` | Dev-only gate; do not promote automatically |
| MEDIUM | RPC | `issue_local_supabase_mfa_money_desk_grant` | Local Dev Money Desk; do not promote automatically |
| MEDIUM | RPC | `list_customer_order_refund_receipts` | `20261110031000`; customer web/mobile receipt path |

Before proposing any repair, confirm each routine's full signature and schema, compare the active deployed Edge bundle with `main`, and inspect the exact migration's prerequisites. A name-only miss is a guard signal, not authorization to apply a migration. The customer receipt miss deserves separate investigation even with disabled routes because existing orders can load receipts.
