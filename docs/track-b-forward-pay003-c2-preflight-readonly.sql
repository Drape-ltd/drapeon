-- Planning artifact only. Do not run until the founder separately approves the
-- exact B2 or C2 read-only preflight. The operator must first confirm that the
-- selected project is Drape-PROD (project ref wkfsrunetmgjdtcurmoj).
-- Run only the block for the approved batch; do not run this as db push.
-- Record counts, types, hashes and grants only. Stop on an unexpected shape.

-- B2 exact pending version/name list (four forward files; all must be absent).
with planned(version,name) as (values
  ('20261118222734','prod_forward_pay003_schema'),
  ('20261118223008','prod_forward_pay003_runtime'),
  ('20261118223016','prod_forward_pay003_refund_baseline'),
  ('20261118223018','prod_forward_pay003_hardening')
)
select p.version,p.name,m.name as existing_name
from planned p left join supabase_migrations.schema_migrations m using(version)
order by p.version;

-- Confirm the historical source/Dev aliases did not partially apply here.
select version,name from supabase_migrations.schema_migrations
where version in ('20261030030000','20261030040000','20261030050000',
                  '20261030060000','20261030025422','20261030030335',
                  '20261030031628','20261030031633')
order by version;

-- B2 prerequisite ID and amount/status types; Production orders.id is UUID,
-- order_payments.id is UUID. A different type stops the batch.
select table_name,column_name,udt_name,is_nullable
from information_schema.columns
where table_schema='public'
  and table_name in ('orders','order_payments','order_payment_refund_claims',
                     'order_payment_refund_attempts')
  and column_name in ('id','order_id','payment_id','status','provider',
                      'amount','refunded_amount','partial_refund_count',
                      'provider_refund_id','provider_response')
order by table_name,column_name;

-- B2 target table presence and all present column shapes. The three new
-- tables are expected absent in the older runtime audit.
select c.relname,c.relkind,c.relrowsecurity,
       has_table_privilege('anon',c.oid,'select') as anon_select,
       has_table_privilege('authenticated',c.oid,'select') as authenticated_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
  ('payment_status_transition_audits','order_payment_provider_refunds',
   'payment_late_success_refund_operations') order by c.relname;
select table_name,column_name,udt_name,is_nullable
from information_schema.columns
where table_schema='public' and table_name in
  ('payment_status_transition_audits','order_payment_provider_refunds',
   'payment_late_success_refund_operations')
order by table_name,ordinal_position;

-- B2 predecessor function and guard fingerprints; review each returned hash,
-- signature, owner, search_path, security mode and service/client EXECUTE
-- before approving any replacement.
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,
       pg_get_userbyid(p.proowner) as owner,p.prosecdef as security_definer,
       p.proconfig as config,md5(pg_get_functiondef(p.oid)) as definition_md5,
       has_function_privilege('anon',p.oid,'execute') as anon_execute,
       has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
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
   'record_bachs_payment_refund_attempt_outcome')
order by p.proname,args;
select c.relname as table_name,t.tgname as trigger_name,
       t.tgfoid::regprocedure::text as function_name,t.tgenabled
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where not t.tgisinternal and t.tgname in
  ('order_payment_forward_status_guard','order_payment_backed_advancement_guard')
order by c.relname,t.tgname;

-- B2 counts. The five invariant counts and the pre-schema baseline count
-- must all be zero. If baseline count is nonzero, the data file aborts and
-- requires a separate evidence-scoped review. Capture EXPLAIN shape only.
select
  count(*) filter (where status='SUCCEEDED' and coalesce(refunded_amount,0)>0) as succeeded_with_refund,
  count(*) filter (where status='REFUNDED' and coalesce(refunded_amount,0)<>amount) as refunded_amount_mismatch,
  count(*) filter (where status='PARTIAL_REFUND'
                   and (coalesce(refunded_amount,0)<=0 or refunded_amount>=amount)) as invalid_partial_refund,
  count(*) filter (where coalesce(refunded_amount,0)>amount) as over_refunded,
  count(*) filter (where refunded_at is not null
                   and status not in ('REFUNDED','PARTIAL_REFUND')) as refund_timestamp_status_mismatch,
  count(*) filter (where coalesce(refunded_amount,0)>0) as pre_schema_baseline_candidates
from public.order_payments;
explain (format json)
select payment.id from public.order_payments payment
where coalesce(payment.refunded_amount,0)>0;
select status,provider,count(*) as routes from public.payment_routes
group by status,provider order by status,provider;

-- C2 exact pending version/name list (three forward files; all must be absent).
with planned(version,name) as (values
  ('20261118223234','prod_forward_c2_payout_guard'),
  ('20261118223236','prod_forward_c2_destination_baseline'),
  ('20261118223241','prod_forward_c2_returned_funds_guard')
)
select p.version,p.name,m.name as existing_name
from planned p left join supabase_migrations.schema_migrations m using(version)
order by p.version;
select version,name from supabase_migrations.schema_migrations
where version in ('20261030100000','20261030110000','20261030120000',
                  '20261030033923','20261030033930','20261030034543')
order by version;

-- C2 current ID bridge and predecessor guard/function/trigger fingerprints.
-- Production payouts.order_id is UUID; payout_claims.order_id is text.
select table_name,column_name,udt_name,is_nullable
from information_schema.columns
where table_schema='public' and table_name in
  ('payouts','payout_claims','tip_money_operation_claims',
   'payout_destination_corrections','payout_provider_operations')
  and column_name in ('id','id_text','order_id','payout_id','claim_id',
                      'provider_destination_id','status','amount','currency',
                      'provider_payout_id','provider_response')
order by table_name,column_name;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,
       pg_get_userbyid(p.proowner) as owner,p.prosecdef as security_definer,
       p.proconfig as config,md5(pg_get_functiondef(p.oid)) as definition_md5,
       has_function_privilege('anon',p.oid,'execute') as anon_execute,
       has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in
  ('guard_payout_forward_status','apply_stripe_transfer_event_to_payout',
   'sync_returned_snapshot_tranche_payout')
order by n.nspname,p.proname,args;
select c.relname as table_name,t.tgname as trigger_name,
       t.tgfoid::regprocedure::text as function_name,t.tgenabled
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where not t.tgisinternal and t.tgname in
  ('payout_forward_status_guard','payout_claim_sync_returned_snapshot_tranche')
order by c.relname,t.tgname;

-- C2 exact data predicate. Both counts must be zero for the supplied
-- data-only file; any nonzero result needs separate reviewed row evidence.
with candidates as (
  select claim.payout_id,claim.provider_destination_id
  from public.payout_claims claim
  where nullif(btrim(claim.provider_destination_id),'') is not null
  union all
  select tip_claim.payout_id,
    nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'),'')
  from public.tip_money_operation_claims tip_claim
  where nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'),'') is not null
), grouped as (
  select payout_id,count(distinct provider_destination_id) as destination_count
  from candidates group by payout_id
)
select count(*) filter (where destination_count=1) as repairable,
       count(*) filter (where destination_count>1) as conflicting
from grouped join public.payouts payout on payout.id::text=grouped.payout_id
where payout.provider_destination_id is null;
explain (format json)
with candidates as (
  select claim.payout_id,claim.provider_destination_id
  from public.payout_claims claim
  where nullif(btrim(claim.provider_destination_id),'') is not null
  union all
  select tip_claim.payout_id,
    nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'),'')
  from public.tip_money_operation_claims tip_claim
  where nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'),'') is not null
), grouped as (
  select payout_id,count(distinct provider_destination_id) as destination_count
  from candidates group by payout_id
)
select payout.id from grouped join public.payouts payout
  on payout.id::text=grouped.payout_id
where payout.provider_destination_id is null;
