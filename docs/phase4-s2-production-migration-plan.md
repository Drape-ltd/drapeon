# Phase 4 S2 Production migration review draft

Status: **prepare only**. Five historical versions are proposed in dependency order; none is approved for Production. No Production write was made.

| Version | Intended change | Read-only Production finding, 2026-11-25 |
| --- | --- | --- |
| `20261102234537` | Add service-only reviewed fabric-release recovery queue RPC. | Exact RPC absent. |
| `20261108224000` | Add dispatch-refund retry table, guard, indexes, service-only queue RPC and fulfillment-run refund ID column. | Table, RPC and column absent. |
| `20261108224518` | Replace money-job wake functions and add unowned-job wake trigger. | Both **function names already exist**, trigger absent. Definitions must be compared before any apply; history absence does not prove function absence. |
| `20261110030000` | Add Money Desk `provider_readiness_checked_at` evidence column. | Column absent; confirm exact source column in preflight. |
| `20261110031000` | Add authenticated customer refund-receipt RPC. | RPC absent. |

Read-only `pg_get_functiondef` comparison on 2026-11-25 found the current wake functions contain only payment webhook, TIP payout and fabric-release job types. The source retains those branches and adds dispatch refund, delivery webhook and communication campaign. The existing payment and fabric wake triggers and active `process-money-jobs-recovery` cron each exist once; the new unowned-job trigger is absent. This resolves the immediate overwrite concern at the **job-type branch** level, but a full Production-shaped compilation and all prerequisite checks still gate release. Recheck live definitions immediately before any apply.

## Exact preflight

Confirm Production project ref `wkfsrunetmgjdtcurmoj`, the Production-only guard marker, all five source versions absent, the prerequisite tables and UUID/text types, the expected existing function/trigger definitions, and zero enabled routes. Use names and aggregate counts in the PR; do not expose customer rows.

```sql
select version from supabase_migrations.schema_migrations where version in
 ('20261102234537','20261108224000','20261108224518',
  '20261110030000','20261110031000') order by version;
select to_regclass('public.dispatch_refund_retry_operations') is not null as retry_table,
 to_regprocedure('public.queue_reviewed_fabric_release_recovery(uuid,text,text)') is not null as fabric_rpc,
 to_regprocedure('public.queue_reviewed_dispatch_refund_retry(uuid,text,text)') is not null as dispatch_rpc,
 to_regprocedure('public.wake_money_job_worker()') is not null as wake_worker,
 to_regprocedure('public.wake_due_money_jobs()') is not null as wake_due,
 to_regprocedure('public.list_customer_order_refund_receipts(text)') is not null as receipt_rpc;
select tgname,tgenabled,pg_get_triggerdef(oid) from pg_trigger
 where tgname='trg_wake_unowned_job_worker' and not tgisinternal;
select table_name,column_name,data_type from information_schema.columns
 where table_schema='public' and table_name in
 ('order_fulfillment_runs','money_desk_execution_attempts','job_queue',
  'order_payments','orders','order_payment_provider_refunds')
 and column_name in ('id','order_id','payment_id','customer_provider_refund_id',
  'provider_readiness_checked_at','event_id','dedupe_key');
select count(*) filter (where status='ENABLED') as enabled_routes from public.payment_routes;
```

Then inspect grants, RLS and checks on the affected tables; repeat the wake-function comparison against source and any later repair. A source effect that is already live requires a separate history-only or forward-repair decision, not a blind replay.

## Rehearsal, apply, postflight

Compile and reapply the exact five files in an isolated Production-shaped local stack, using Dev's already-applied schema as a separate idempotence check. Run `pnpm launch:contracts` under Node 22 and `git diff --check`. The guarded exact-version apply procedure must verify the Production project, guard marker, current version absence and previous-version success inside each transaction. Stop on the first error; no broad `db push`, source rewrite, fabricated provider event or route enablement. The executable wrapper remains held until the full prerequisite and type comparison is reviewed.

Postflight checks each exact ledger row, new column/table/index/trigger bindings, service-only RPC grants, authenticated receipt RPC grant, queue wake health, Advisors, zero missing-column job failures, and zero enabled routes. Retain prior wake-function definitions for a reviewed forward restoration if a behavior regression is found. Treat a failed dispatch retry guard as a forward-fix incident; do not delete retry rows or send another provider refund.
