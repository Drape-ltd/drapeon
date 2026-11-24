# PAY-003 / C2 Production release worksheet — 2026-11-24

**Preparation only. Do not apply either batch without the founder's separate
approval.** Target: Drape-PROD `wkfsrunetmgjdtcurmoj`. Use exact versions in
order, never `db push`. Stop at the first failed preflight, migration or
postflight; record the actual state before proposing a new forward fix.

## Why this is a release gate

PR #235 is merged, but Production history has none of its seven versions. A
read-only catalog check confirms the three PAY-003 target tables and the
late-success refund RPCs are absent. Deployed Bachs webhook v4 and Stripe
webhook v56 reference the missing RPCs. The route is `DISABLED`; the
`payment_webhook_events` read-only check supplied by Claude found only two
historical Stripe events, last on 2026-09-16, none in the past seven days and
no Bachs events. **This is a latent existing-event/late-success risk, not an
observed active payment incident.** No matching missing-RPC error was seen in
the sampled 24-hour logs.

`20261118220734` is **out of scope**. It is absent from Production and its
`get_my_tailor_profile_guard` definition reads Dev-only
`tailor_profiles.lifecycle_state`, which Production lacks. Do not include it in
either batch or a broad migration push.

## Current read-only catalog evidence

- Supabase project lookup returned `Drape-PROD`, ref
  `wkfsrunetmgjdtcurmoj`, `ACTIVE_HEALTHY`.
- All seven source versions and `20261118220734` are absent from
  `supabase_migrations.schema_migrations`. None of the historical PAY-003 or C2
  alias chains is partially present (all four alias groups count zero).
- `orders.id`, `order_payments.id` and `payouts.id` are UUID;
  `payout_claims.order_id` and `payout_claims.payout_id` are text. This is the
  mixed-ID shape the forward files guard.
- `payment_status_transition_audits`, `order_payment_provider_refunds` and
  `payment_late_success_refund_operations` are absent. The sampled PAY-003
  trigger names and late-success RPCs are absent.
- Existing `record_bachs_payment_refund_attempt_outcome(uuid,text,text,jsonb)`
  is service-callable, not client-callable; its current definition MD5 is
  `9ba40ca5ae696e2bccc4d15ee6a4ee76`. Batch 1 hardening replaces it on
  this zero-alias Production path; recheck its hash before release.
- Existing `private.sync_returned_snapshot_tranche_payout()` is bound to the
  enabled `payout_claim_sync_returned_snapshot_tranche` trigger. Its current
  definition MD5 is `dc482cedf4e06c760869f44ffae99595`; Batch 2 replaces
  the function body while preserving the binding. Recheck both before release.
- `order_payments` has zero rows; the PAY-003 legacy-refund candidate and all
  sampled refund-invariant counts are zero. C2 destination repairable and
  conflicting counts are both zero.
- One Production payment route is `DISABLED`; zero are enabled.

The repository's complete read-only preflight SQL is
[`track-b-forward-pay003-c2-preflight-readonly.sql`](track-b-forward-pay003-c2-preflight-readonly.sql).
Re-run it on Drape-PROD for the relevant batch immediately before approval.
History absence alone is insufficient to approve a migration.

## Batch 1 — PAY-003, four exact versions

| Version | Change | Current-Production idempotence / stop rule |
| --- | --- | --- |
| `20261118222734` | Creates `payment_status_transition_audits`, `order_payment_provider_refunds`, `payment_late_success_refund_operations`, keys/FKs/index, RLS and service-only grants. | All three targets are absent; base UUID IDs match. `CREATE TABLE IF NOT EXISTS` is followed by explicit shape, FK and key checks. Stop if a table appears or any shape/grant differs at preflight. |
| `20261118223008` | Installs late-success reservation/outcome RPCs, payment status and order advancement guards, refund reconciliation/confirmation RPCs, and two guard triggers; limits EXECUTE to service role where callable. | Target RPCs and guard triggers are absent. Historical alias count is zero, so the migration takes its checked forward branch. It replaces definitions by exact signature and recreates named triggers; stop on unexpected predecessor definitions or grants. |
| `20261118223016` | Data-only legacy confirmed-refund baseline for `order_payment_provider_refunds`. | `order_payments` has zero rows and zero baseline candidates. The file aborts on a nonzero candidate or insert; recheck immediately before the batch. No row is expected to be written. |
| `20261118223018` | Tightens payment/refund guards, installs Bachs refund-attempt outcome and final late-success/transition bodies, and service-only grants. | Alias count is zero. The current Bachs outcome RPC is the only sampled predecessor and its MD5 is recorded above. Recheck signature/hash/ACL and stop if changed; the migration replaces that body by exact signature. |

### Batch 1 preflight queries

Run the existing preflight SQL's **B2** block, including its six invariant
counts and `EXPLAIN`, plus the environment guard below. Expected: all four
versions absent, no partial alias chain, three target tables absent, zero
baseline candidates, base types as above, and zero enabled routes.

```sql
select current_database() as database_name;
-- Operator must independently confirm the Supabase target is
-- Drape-PROD / wkfsrunetmgjdtcurmoj before running any SQL.
select version, name from supabase_migrations.schema_migrations
where version in ('20261118222734','20261118223008',
                  '20261118223016','20261118223018');
select to_regclass('public.payment_status_transition_audits') as transition_audits,
       to_regclass('public.order_payment_provider_refunds') as provider_refunds,
       to_regclass('public.payment_late_success_refund_operations') as late_refunds;
select count(*) as payment_rows,
       count(*) filter (where coalesce(refunded_amount,0)>0) as baseline_candidates
from public.order_payments;
```

### Batch 1 postflight queries

Expected: four exact migration ledger rows; three tables with RLS on,
client SELECT denied, service-role grants matching the file; required PK/FK
and `(provider,provider_refund_id)` unique key; all named RPC signatures and
two active guard triggers; no new baseline refund rows; zero enabled routes.

```sql
select version,name from supabase_migrations.schema_migrations
where version in ('20261118222734','20261118223008',
                  '20261118223016','20261118223018') order by version;
select c.relname,c.relrowsecurity,
       has_table_privilege('anon',c.oid,'select') as anon_select,
       has_table_privilege('authenticated',c.oid,'select') as user_select,
       has_table_privilege('service_role',c.oid,'select') as service_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
  ('payment_status_transition_audits','order_payment_provider_refunds',
   'payment_late_success_refund_operations') order by c.relname;
select c.conrelid::regclass::text as table_name,c.contype,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.conrelid in
  ('public.payment_status_transition_audits'::regclass,
   'public.order_payment_provider_refunds'::regclass,
   'public.payment_late_success_refund_operations'::regclass)
order by table_name,c.contype;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon',p.oid,'execute') as anon_execute,
       has_function_privilege('authenticated',p.oid,'execute') as user_execute,
       has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('reserve_payment_late_success_refund',
   'record_payment_late_success_refund_outcome',
   'guard_order_payment_forward_status',
   'apply_order_payment_status_transition',
   'guard_order_payment_backed_advancement',
   'reconcile_failed_order_payment_refund',
   'record_confirmed_order_payment_refund',
   'record_bachs_payment_refund_attempt_outcome') order by p.proname,args;
select t.tgname,t.tgenabled,t.tgfoid::regprocedure::text as function_name
from pg_trigger t where not t.tgisinternal and t.tgname in
  ('order_payment_forward_status_guard','order_payment_backed_advancement_guard');
select count(*) as baseline_rows from public.order_payment_provider_refunds;
select status,count(*) from public.payment_routes group by status;
```

After SQL, re-run Security/Performance/Health Advisors, cron/queue health,
Disk I/O and the affected synthetic failure path. A newly introduced warning,
missing grant/trigger, unexpected row, health regression or enabled route
stops release work. No Edge or route change is bundled with these migrations.

## Batch 2 — C2, three exact versions

| Version | Change | Current-Production idempotence / stop rule |
| --- | --- | --- |
| `20261118223234` | Installs payout forward-status identity guard, Stripe transfer-event application RPC, named payout guard trigger and service-only grants. | `guard_payout_forward_status`, `apply_stripe_transfer_event_to_payout` and the named trigger are absent. C2 alias count is zero, so the forward branch is selected. Stop if predecessor signature/ID type changes. |
| `20261118223236` | Data-only destination baseline for payouts, sourced from existing payout and TIP claims. | Production repairable and conflicting counts are both zero. File aborts if any candidate or update appears; recheck immediately before Batch 2. |
| `20261118223241` | Replaces payout guard with reviewed returned-funds handling and updates `private.sync_returned_snapshot_tranche_payout()`; revokes direct API-role EXECUTE. | The private function/active claim trigger already exist with the hash above. The file checks that binding. Recheck hash and trigger immediately before replacing; unexpected drift stops the batch. |

### Batch 2 preflight queries

Run the existing preflight SQL's **C2** block, including mixed-ID types,
predecessor function hashes, trigger binding, exact zero-candidate query and
`EXPLAIN`. Batch 1 postflight must already be green. Expected: all three C2
versions absent, no partial C2 alias chain, zero repairable/conflicting
destinations, zero enabled routes.

```sql
select version,name from supabase_migrations.schema_migrations
where version in ('20261118223234','20261118223236','20261118223241');
with candidates as (
  select payout_id,provider_destination_id from public.payout_claims
  where nullif(btrim(provider_destination_id),'') is not null
  union all
  select payout_id,nullif(btrim(provider_response #>> '{transfer,destination}'),'')
  from public.tip_money_operation_claims
  where nullif(btrim(provider_response #>> '{transfer,destination}'),'') is not null
), grouped as (
  select payout_id,count(distinct provider_destination_id) as destination_count
  from candidates group by payout_id
)
select count(*) filter (where destination_count=1) as repairable,
       count(*) filter (where destination_count>1) as conflicting
from grouped join public.payouts payout on payout.id::text=grouped.payout_id
where payout.provider_destination_id is null;
```

### Batch 2 postflight queries

Expected: three exact migration ledger rows; payout guard and returned-claim
trigger active and correctly bound; expected RPC signatures, grants and
search paths; no unexpected payout destination repair; Advisors/health green
relative to the preflight; zero enabled routes.

```sql
select version,name from supabase_migrations.schema_migrations
where version in ('20261118223234','20261118223236','20261118223241')
order by version;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,
       p.proconfig,
       has_function_privilege('anon',p.oid,'execute') as anon_execute,
       has_function_privilege('authenticated',p.oid,'execute') as user_execute,
       has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname in
  ('guard_payout_forward_status','apply_stripe_transfer_event_to_payout'))
   or (n.nspname='private' and p.proname='sync_returned_snapshot_tranche_payout')
order by n.nspname,p.proname,args;
select c.relname,t.tgname,t.tgenabled,t.tgfoid::regprocedure::text as function_name
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where not t.tgisinternal and t.tgname in
  ('payout_forward_status_guard','payout_claim_sync_returned_snapshot_tranche');
select count(*) as payouts_missing_destination from public.payouts
where provider_destination_id is null;
select status,count(*) from public.payment_routes group by status;
```

Compare the payout count with its preflight baseline; a nonzero count may be
valid for unrelated legacy rows and must not be interpreted alone as a
failure. Re-run Advisors, health, cron/queue state and Disk I/O after Batch 2.
No route is enabled as part of this release.

## Recovery and approval boundary

Neither batch has a safe generic SQL rollback: it installs guards on live
money state and Batch 1 creates new tables. On an error, stop immediately,
capture exact migration ledger/catalog/advisor state, keep routes disabled,
and propose a reviewed **new forward migration**. Do not rerun a partially
applied batch, drop these tables, restore older guard bodies, or mark a version
applied without verifying its SQL effects. The founder approves Batch 1, its
postflight, then Batch 2 separately. This worksheet does not grant either
approval.
