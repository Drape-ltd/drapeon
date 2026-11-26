# Phase 4 S4 Production migration review draft

Status: **prepare only; final review requested after CI**. No Production write or approval to apply. The Production proposal is three historical versions plus one UUID-safe forward version; the two historical failed-refund recovery versions are excluded.

**Post-S3 forward-design check, 2026-11-26:** S4's retry-grace trigger reads `payout_claim_retry_authorizations.prior_operation_id` and `claim_id`, both created by S3 forward `20261126173651`. Its failed-refund recovery uses the refund journal that S3 forward `20261126174309` reconciles. S3 is now applied in Production; the final four-file S4 proposal compiled in a rolled-back Production-shaped local transaction after PAY-003/C2 and both S3 forward files. The separate UUID runtime proof below covers the recovery path that compilation alone missed. No Production S4 change was made.

| Version | Source effect | Production read-only finding, 2026-11-25 |
| --- | --- | --- |
| `20261111130000` | Add settlement eligibility timestamp/index and two service-only due-plan scan RPCs. | Version and due-plan RPC absent. |
| `20261111180000` | Add payout-claim retry grace guard and INSERT trigger. | Version and guard function absent. |
| `20261112001443` | Expand Money Desk event-type check for approval notices. | Version absent; current check allows only REQUEST_SUBMITTED, APPROVAL_RECORDED, REQUEST_APPROVED, REQUEST_REJECTED, EXECUTION_STARTED, EXECUTION_SUCCEEDED, EXECUTION_FAILED, EXECUTION_BLOCKED and REQUEST_CANCELLED. |
| `20261126182736` | Create final Ops-issue-bound reviewed failed-refund recovery with UUID-to-text order bridges. | Version and RPC absent in Production; applied once in Dev, where only service_role can execute it. |

All four proposed markers are absent and payment routes are disabled. Historical `20261111160000` and `20261111183000` also remain absent and **must stay unrecorded in Production**: both compare text request/issue/ledger order IDs directly with UUID payment order IDs, failing at runtime. New forward `20261126182736` carries the final Ops-issue binding and casts only the payment order ID bridge to text. The old files remain as immutable Dev history, never a Production replay. S4 does not include scheduler sources `20261111131000` or `20261112213000`; those belong to J1.

The separate default-ACL repair `20261126080246` must be applied and verified before any S4 version. S4 creates no table or sequence. Every new service-only function must explicitly revoke `PUBLIC`, `anon` and `authenticated` EXECUTE before granting `service_role`; source and final ACLs must be compared before promotion. The following per-batch post-check must return zero rows, and all four function names must exist:

```sql
select p.proname, coalesce(a.grantee::regrole::text,'PUBLIC') as grantee,
       a.privilege_type
from pg_proc p cross join lateral
     aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
where p.pronamespace='public'::regnamespace
  and p.proname in ('list_due_settlement_eligibility_tranches',
                   'list_due_settlement_eligibility_plans',
                   'complete_reviewed_failed_refund_journal_recovery',
                   'enforce_payout_claim_retry_grace')
  and (a.grantee=0 or a.grantee in
       ('anon'::regrole,'authenticated'::regrole));
```

A fresh 2026-11-26 read-only Production catalog check after S3 found S1 5/5, S2 5/5 and S3 2/2 recorded; all four proposed S4 versions absent (0/4), the two excluded historical refund versions absent (0/2), `order_settlement_plans.last_eligibility_scan_at` absent and zero overloads for all four S4 RPC/guard names:
`list_due_settlement_eligibility_tranches`,
`list_due_settlement_eligibility_plans`,
`complete_reviewed_failed_refund_journal_recovery`, and
`enforce_payout_claim_retry_grace`. The S3 retry table exists with zero rows, the grace trigger is absent, and Money Desk events have zero rows. The current Money Desk CHECK allows the nine existing event types and the proposed source only adds three founder-approval email outcomes. Production has zero enabled routes. The now-live S3 function MD5s are `guard_payout_forward_status` `1b76b0b8c4317205d1b71032caaa5535`, `prevent_payout_provider_operation_identity_change` `382e801356360b605b47ef15e9567222`, `reconcile_failed_order_payment_refund` `6c66c48a0647ce041cf04d354ed1f488`, and `reconcile_definite_payout_rejection` `963b0905dec6771da248d49ccfddb93c`. None of the four S4 files replaces these functions. Recheck before any apply.

### Isolated compile and runtime rehearsal — 2026-11-26

The initial five-historical-file compile passed but was insufficient: PostgreSQL deferred the text/UUID comparison in the recovery function until runtime. A Production-shaped UUID test now demonstrates the historical final body fails with `operator does not exist: text = uuid`; forward `20261126182736` applies and reapplies, then completes the reviewed refund journal reversal and duplicate replay with one reversal, and denies client EXECUTE. In a separate disposable Production-shaped rollback transaction, the seven PAY-003/C2 source files, both S3 forward files and the **final four S4 files** compiled in order; all four expected S4 function names existed before rollback. No Production SQL was run.

Dev history records all five historical S4 versions and the new forward `20261126182736` once. Dev postflight confirmed the forward recovery RPC is service-only (anon/authenticated EXECUTE false), with zero enabled routes. The forward RPC body hashes to `acf5aa5c1a2b4a114c706647384a8d4b` on Dev. Dev's historical versions do not authorize recording them in Production.

## Exact preflight before review

Verify project ref `wkfsrunetmgjdtcurmoj`, #343/S1/S2/S3 markers present, the four proposed markers absent, and excluded `20261111160000`/`20261111183000` absent. Recheck `order_settlement_plans` types and missing eligibility column, S3 retry table and missing grace trigger, Money Desk event check/values, four absent S4 function names, and zero routes. Production `money_desk_requests.order_id`, `ops_issues.order_id`, and `commercial_ledger_transactions.order_id` are text while `order_payments.order_id` is UUID; the forward body must retain the three explicit `::text` bridges. Compare the current Money Desk CHECK with the proposed superset and count affected rows before changing it. A preexisting effect or conflicting body requires a new forward or history-only decision.

## Rehearsal and postflight

Compile and reapply in an isolated Production-shaped local database; verify Dev has the forward effect and run Node 22 `pnpm launch:contracts` and `git diff --check`. Prepare a guarded exact-version executor only after this review. Apply only `20261111130000`, `20261111180000`, `20261112001443`, `20261126182736`, in that order, each transactionally and only after separate approval. Record a history row only on SQL success and stop at first error. No broad `db push`, historical recovery replay, scheduler activation, provider call, or route enablement.

After a separately approved release, verify the four proposed ledger rows and both excluded historical rows still absent; eligibility column/index; both due-plan RPC signatures and service-role grants; recovery RPC final body, search path and grants; retry grace trigger binding; Money Desk check and counts; Advisors, queue/cron health, and zero enabled routes. Preserve prior function/check definitions for a reviewed forward fix if behavior diverges. Do not replay refund or payout provider operations as rollback.
