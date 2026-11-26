# Phase 4 S4 Production migration review draft

Status: **prepare only**. No Production write or approval to apply.

| Version | Source effect | Production read-only finding, 2026-11-25 |
| --- | --- | --- |
| `20261111130000` | Add settlement eligibility timestamp/index and two service-only due-plan scan RPCs. | Version and due-plan RPC absent. |
| `20261111160000` | Add reviewed failed-refund journal recovery RPC. | Version and RPC absent. |
| `20261111180000` | Add payout-claim retry grace guard and INSERT trigger. | Version and guard function absent. |
| `20261111183000` | Replace recovery RPC with Ops-issue binding. | Version absent; apply only after the base RPC, with body comparison. |
| `20261112001443` | Expand Money Desk event-type check for approval notices. | Version absent; current check allows only REQUEST_SUBMITTED, APPROVAL_RECORDED, REQUEST_APPROVED, REQUEST_REJECTED, EXECUTION_STARTED, EXECUTION_SUCCEEDED, EXECUTION_FAILED, EXECUTION_BLOCKED and REQUEST_CANCELLED. |

All five source markers are absent and payment routes are disabled. The source file `11183000` deliberately replaces the function introduced by `11160000`; the pair must be rehearsed in order. S4 does not include the scheduler source `20261111131000` or `20261112213000`; those belong to J1 after this schema/function unit.

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

A 2026-11-26 read-only Production catalog check found
`order_settlement_plans.last_eligibility_scan_at` absent and zero overloads
for all four S4 RPC/guard names:
`list_due_settlement_eligibility_tranches`,
`list_due_settlement_eligibility_plans`,
`complete_reviewed_failed_refund_journal_recovery`, and
`enforce_payout_claim_retry_grace`. This confirms that S4 adds missing
behavior; it does not prove the S3 retry-table prerequisite or the current
Money Desk check is ready for the five historical source files.

### Isolated compile rehearsal — 2026-11-26

All five exact S4 source files compiled in order in a local rollback-only transaction, after the older rehearsal baseline was supplemented with the exact PAY-003 schema and S3 retry-authorization table that precede S4 in Production release order. The transaction reached `S4_ROLLBACK_COMPLETE` and left no schema changes. This does not establish current Production function-body equivalence, ACL parity, Dev reapplication, or migration-history behavior; those remain required before release review.

Dev history records all five exact S4 versions. Read-only Dev catalog checks
confirmed `complete_reviewed_failed_refund_journal_recovery(uuid,uuid,jsonb)`
and the enabled `enforce_payout_claim_retry_grace_before_insert` trigger;
payment routes remain disabled. A later function replacement may have changed
the live body, so this does not establish source-to-current semantic equality.

## Exact preflight before review

Verify project ref `wkfsrunetmgjdtcurmoj`, the Production environment guard, the five ledger markers absent, `order_settlement_plans` ID and eligibility column types, payout-claim retry table and trigger prerequisites, Money Desk event column/check and current data values, the current recovery RPC and grants, zero enabled routes, and a counts-only snapshot of due plans, relevant failed-refund claims, and Money Desk events. Compare every SQL function's types against Production UUID/text columns. A preexisting effect or conflicting function body requires a new forward repair or history-only decision, never a blind replay.

## Rehearsal and postflight

Compile and reapply in an isolated Production-shaped local database; verify Dev already has the effects and run Node 22 `pnpm launch:contracts` and `git diff --check`. Prepare a guarded exact-version executor only after this review. Apply each approved version transactionally in source order, recording its history row only on SQL success and stopping at first error. No broad `db push`, scheduler activation, provider call, or route enablement.

After a separately approved release, verify five ledger rows; eligibility column/index; both due-plan RPC signatures and service-role grants; recovery RPC final body, search path and grants; retry grace trigger binding; Money Desk check and counts; Advisors, queue/cron health, and zero enabled routes. Preserve prior function/check definitions for a reviewed forward fix if behavior diverges. Do not replay refund or payout provider operations as rollback.
