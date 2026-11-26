# Phase 4 S2 Production migration review draft

Status: **prepare only**. Four historical versions plus one new forward repair are proposed in dependency order; none is approved for Production. No Production write was made.

**Grant review correction, 2026-11-26:** Dev's
`dispatch_refund_retry_operations` has inherited `service_role` DELETE,
REFERENCES, TRIGGER and TRUNCATE in addition to SELECT, INSERT and UPDATE.
Claude confirmed this is Supabase's standard service-role default, not a
reason to split S2. The real prerequisite is the separate `postgres` default
ACL repair `20261126080246` before any S-batch, plus explicit per-object
client-role revokes and an `aclexplode` post-check. The historical S2 table
and function migration already revokes `PUBLIC`, `anon` and `authenticated`
on its new objects; the UUID receipt RPC is intentionally callable by
`authenticated` after its `PUBLIC`/`anon` revokes and explicit grant. Its
Dev-applied source is immutable. No extra S2 migration is proposed.

| Version | Intended change | Read-only Production finding, 2026-11-25 |
| --- | --- | --- |
| `20261102234537` | Add service-only reviewed fabric-release recovery queue RPC. | Exact RPC absent. |
| `20261108224000` | Add dispatch-refund retry table, guard, indexes, service-only queue RPC and fulfillment-run refund ID column. | Table, RPC and column absent. |
| `20261108224518` | Replace money-job wake functions and add unowned-job wake trigger. | Both **function names already exist**, trigger absent. Definitions must be compared before any apply; history absence does not prove function absence. |
| `20261110030000` | Add Money Desk `provider_readiness_checked_at` evidence column. | Column absent; confirm exact source column in preflight. |
| `20261126071500` | Add authenticated customer refund-receipt RPC with native UUID order/customer comparisons and text ledger bridge. | RPC absent; guarded Dev text-ID branch applied without replacing its existing RPC. |

Read-only `pg_get_functiondef` comparison on 2026-11-25 found the current wake functions contain only payment webhook, TIP payout and fabric-release job types. The source retains those branches and adds dispatch refund, delivery webhook and communication campaign. The existing payment and fabric wake triggers and active `process-money-jobs-recovery` cron each exist once; the new unowned-job trigger is absent. This resolves the immediate overwrite concern at the **job-type branch** level, but a full Production-shaped compilation and all prerequisite checks still gate release. Recheck live definitions immediately before any apply.

The 2026-11-26 read-only Production privilege check found both existing wake
functions are `SECURITY DEFINER` with an empty search path, callable by
`service_role` and not by `anon` or `authenticated`. Their current
`pg_get_functiondef` MD5 values are `3aafe7558c7f5dc1a2bcd10ce31777f1`
for `wake_money_job_worker()` and `58246ac3785f76d3eacf329496f64e00`
for `wake_due_money_jobs()`. The three proposed new RPC names remain absent.
Record these hashes again immediately before apply and stop if either changes.

### Compile blocker found 2026-11-26

In a rollback-only local transaction, the first four exact source files compiled once the rehearsal baseline included the already-applied PAY-003 schema and active recovery-cron fixture. Historical `20261110031000` failed with PostgreSQL `42883 operator does not exist: text = uuid` at `commercial_ledger_transactions.order_id = orders.id`. Read-only Production catalog confirms ledger `order_id` is `text`, while `orders.id` and `orders.customer_id` are `uuid`; Dev uses text IDs. **Do not apply historical `20261110031000` to Production.** Forward version `20261126071500` uses native UUID comparisons for payment and customer IDs and casts only the ledger text bridge. It compiled with the four preceding files in the rollback-only Production-shaped rehearsal; a malformed order ID and a nonexistent all-zero UUID each returned zero rows, so the UUID query body executed without a type error. The forward repair reapplied cleanly in the same local transaction. Its guarded rollback file removed only that local UUID RPC, and the outer transaction then rolled back. Its guarded Dev text-ID branch applied without changing the existing RPC. Supabase's generated Dev marker `20261126071618` was reverted and source marker `20261126071500` marked applied through the supported history-only workflow. The source marker is present, generated marker absent, and Dev has zero enabled routes. At this checkpoint, a real authenticated refund-receipt row and full ACL comparison remained owed before Production review.

On 2026-11-26 a rolled-back, read-only Dev role simulation called the
existing receipt RPC as `authenticated` for refund order
`f4170000-0000-4000-8000-000000000001`. The owning Dev QA subject saw
one receipt totaling 10,200 minor NGN units; a distinct documented Dev QA
subject saw zero rows for that same order. No provider reference or customer
data was returned to the evidence log. This executes the existing Dev text-ID
body with a real refund row and checks the ownership boundary; the new
Production UUID body was exercised only with nonexistent IDs in local rehearsal.
The earlier "real authenticated refund-receipt row" gap is closed for Dev;
a full Production ACL comparison remains owed.

## Exact preflight

Dev `supabase db lint --linked --schema public --level error --fail-on error`
returned three existing `42883` reports in
`public.finalize_reviewed_adjustment_transfer` (`integer = text`). It did not
report the customer refund-receipt RPC. That unrelated Dev lint gate remains
open; it is not evidence that this migration itself failed to compile.
Node 22 `pnpm launch:contracts` passed on the branch after the forward repair
was added, and `git diff --check` was clean.
The Dev fabric-release recovery RPC was present, but its source migration had
generated marker `20261103003930`. After a names-only object check, the
supported Dev-only history repair reverted that marker and marked source
`20261102234537` applied, without rerunning SQL. Dev now records all four
historical S2 source versions, its text-ID receipt source `20261110031000`,
and the new forward guard `20261126071500`; the generated marker is absent.

Confirm Production project ref `wkfsrunetmgjdtcurmoj`, the Production-only guard marker, all five proposed versions and the excluded historical version absent, the prerequisite tables and UUID/text types, the expected existing function/trigger definitions, and zero enabled routes. Use names and aggregate counts in the PR; do not expose customer rows.

```sql
select version from supabase_migrations.schema_migrations where version in
 ('20261102234537','20261108224000','20261108224518',
  '20261110030000','20261110031000','20261126071500') order by version;
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

Compile and reapply the four historical files plus `20261126071500` in an isolated Production-shaped local stack, using Dev's already-applied schema as a separate guard/idempotence check. Historical `20261110031000` stays excluded from this Production batch. Run `pnpm launch:contracts` under Node 22 and `git diff --check`. The guarded exact-version apply procedure must verify the Production project, guard marker, current version absence and previous-version success inside each transaction. Stop on the first error; no broad `db push`, source rewrite, fabricated provider event or route enablement. The executable wrapper remains held until the full prerequisite and type comparison is reviewed.

Postflight checks each exact ledger row, new column/table/index/trigger bindings, service-only RPC grants, authenticated receipt RPC grant, queue wake health, Advisors, zero missing-column job failures, and zero enabled routes. Retain prior wake-function definitions for a reviewed forward restoration if a behavior regression is found. Treat a failed dispatch retry guard as a forward-fix incident; do not delete retry rows or send another provider refund.

The per-batch ACL check must return **zero rows**. The customer receipt RPC is
the one intentional `authenticated` exception; its order-owner condition is
tested separately. Run this after the default-ACL repair and S2 apply:

```sql
with acl as (
  select 'table'::text as kind, c.relname::text as object_name,
         a.grantee, a.privilege_type
  from pg_class c cross join lateral
       aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where c.oid=to_regclass('public.dispatch_refund_retry_operations')
  union all
  select 'function', p.proname::text, a.grantee, a.privilege_type
  from pg_proc p cross join lateral
       aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid in (
    to_regprocedure('public.queue_reviewed_fabric_release_recovery(uuid,text,text)'),
    to_regprocedure('public.guard_dispatch_refund_retry_operation()'),
    to_regprocedure('public.queue_reviewed_dispatch_refund_retry(uuid,text,text)'),
    to_regprocedure('public.list_customer_order_refund_receipts(text)')
  )
)
select kind,object_name,coalesce(grantee::regrole::text,'PUBLIC') as grantee,
       privilege_type
from acl
where (grantee=0 or grantee in ('anon'::regrole,'authenticated'::regrole))
  and not (kind='function'
       and object_name='list_customer_order_refund_receipts'
       and grantee='authenticated'::regrole
       and privilege_type='EXECUTE');
```

The release operator must also check that all four named functions and the
retry table exist before treating an empty ACL result as a pass.

On 2026-11-26, after the Dev default-ACL migration `20261126080246`, this
exact `aclexplode` query returned zero unexpected grants. The rolled-back
authenticated role simulation still returned one 10,200-minor-unit receipt
for the owning Dev QA account and zero rows for a distinct Dev QA account.
Dev still had zero enabled payment routes. These checks do not replace the
Production postflight or authorize this batch.
