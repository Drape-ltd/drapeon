#!/usr/bin/env bash
set -euo pipefail

test_db="codex_settlement_scan_$$"
container="${SETTLEMENT_TEST_POSTGRES_CONTAINER:-drape-tranche-local}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
psql_cmd=(docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -d "$test_db")

cleanup() {
  docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "drop database if exists $test_db with (force)" >/dev/null
}
trap cleanup EXIT

docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "create database $test_db" >/dev/null

"${psql_cmd[@]}" <<'SQL' >/dev/null
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create type public.currency as enum ('USD', 'CAD');
create table public.order_settlement_plans (
  id uuid primary key, order_id text not null, tailor_id uuid not null,
  customer_id uuid not null, currency public.currency not null,
  status text not null, created_at timestamptz not null default now()
);
create table public.order_settlement_tranches (
  id uuid primary key, plan_id uuid not null, code text not null, status text not null,
  blocked_reason text, amount integer not null default 100,
  currency public.currency not null default 'USD', eligible_at timestamptz
);
create table public.order_settlement_evidence (
  plan_id uuid not null, evidence_kind text not null, occurred_at timestamptz not null
);
create table public.ops_issues (
  dedupe_key text not null, status text not null default 'OPEN',
  canonical_status text not null default 'NEW', severity text not null default 'MEDIUM'
);
insert into public.order_settlement_plans(id,order_id,tailor_id,customer_id,currency,status)
select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'order-' || n,
  '10000000-0000-4000-8000-000000000001'::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  'USD', case when n=5 then 'FROZEN' else 'ACTIVE' end
from generate_series(1,10) n;
insert into public.order_settlement_tranches(id,plan_id,code,status) values
  ('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','SHIP_DELIVERY_20','LOCKED'),
  ('30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','SHIP_PROTECTION_10','LOCKED'),
  ('30000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','SHIP_PROTECTION_10','LOCKED'),
  ('30000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','LOCAL_SETTLED_20','LOCKED'),
  ('30000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004','SHIP_DELIVERY_20','LOCKED'),
  ('30000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000005','SHIP_DELIVERY_20','LOCKED'),
  ('30000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000006','SHIP_CUSTODY_70','ELIGIBLE'),
  ('30000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000007','SHIP_CUSTODY_70','ELIGIBLE'),
  ('30000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000008','SHIP_DELIVERY_20','ELIGIBLE'),
  ('30000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000009','SHIP_DELIVERY_20','ELIGIBLE'),
  ('30000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','SHIP_DELIVERY_20','ELIGIBLE');
insert into public.order_settlement_tranches(id,plan_id,code,status,blocked_reason) values
  ('30000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000005','SHIP_DELIVERY_20','BLOCKED','OPEN_REVIEW');
insert into public.order_settlement_evidence(plan_id,evidence_kind,occurred_at) values
  ('00000000-0000-4000-8000-000000000001','VERIFIED_DELIVERY',now()-interval '73 hours'),
  ('00000000-0000-4000-8000-000000000002','VERIFIED_DELIVERY',now()-interval '15 days'),
  ('00000000-0000-4000-8000-000000000003','AUTHENTICATED_LOCAL_HANDOFF',now()-interval '73 hours'),
  ('00000000-0000-4000-8000-000000000004','VERIFIED_DELIVERY',now()-interval '71 hours'),
  ('00000000-0000-4000-8000-000000000005','VERIFIED_DELIVERY',now()-interval '15 days');
update public.order_settlement_tranches set eligible_at=now()-interval '5 hours'
where id='30000000-0000-4000-8000-000000000008';
update public.order_settlement_tranches set eligible_at=now()-interval '25 hours'
where id in ('30000000-0000-4000-8000-000000000010',
             '30000000-0000-4000-8000-000000000011');
update public.order_settlement_tranches set eligible_at=now()-interval '2 hours'
where id='30000000-0000-4000-8000-000000000012';
insert into public.ops_issues(dedupe_key,status,canonical_status,severity) values
  ('settlement-eligible:30000000-0000-4000-8000-000000000008','OPEN','NEW','MEDIUM'),
  ('settlement-eligible:30000000-0000-4000-8000-000000000010','OPEN','NEW','HIGH'),
  ('settlement-eligible:30000000-0000-4000-8000-000000000011','RESOLVED','RESOLVED','MEDIUM'),
  ('settlement-eligible:30000000-0000-4000-8000-000000000012','OPEN','NEW','MEDIUM');
SQL

if "${psql_cmd[@]}" -tAc "select count(*) from public.list_due_settlement_eligibility_plans(100)" \
  >/dev/null 2>&1; then
  echo 'RED failed: the selector unexpectedly exists before the migration' >&2
  exit 1
fi
echo 'RED: main has no due-settlement selector'

"${psql_cmd[@]}" < "$repo_root/supabase/migrations/20261111130000_due_settlement_eligibility_scan.sql" >/dev/null
"${psql_cmd[@]}" <<'SQL' >/dev/null
do $$
declare selected text[];
begin
  select array_agg(order_id order by order_id) into selected
  from public.list_due_settlement_eligibility_plans(100);
  if selected is distinct from array['order-1','order-2','order-3','order-5','order-6',
                                     'order-7','order-8']::text[] then
    raise exception 'Unexpected due plans: %', selected;
  end if;
  if has_function_privilege('authenticated',
    'public.list_due_settlement_eligibility_plans(integer)', 'EXECUTE') then
    raise exception 'Authenticated users can call the service-only selector';
  end if;
  if has_function_privilege('authenticated',
    'public.list_due_settlement_eligibility_tranches(uuid)', 'EXECUTE') then
    raise exception 'Authenticated users can call the service-only tranche selector';
  end if;
  if (select needs_notice from public.list_due_settlement_eligibility_tranches(
      '00000000-0000-4000-8000-000000000007'::uuid)) is distinct from false then
    raise exception 'An escalation must reuse the existing case and skip tailor notices';
  end if;
  if (select needs_notice from public.list_due_settlement_eligibility_tranches(
      '00000000-0000-4000-8000-000000000006'::uuid)) is distinct from true then
    raise exception 'A missing case must queue the initial tailor notices';
  end if;
  insert into public.ops_issues(dedupe_key,status,canonical_status,severity)
  values ('settlement-eligible:30000000-0000-4000-8000-000000000007',
          'OPEN','NEW','MEDIUM');
  if exists (select 1 from public.list_due_settlement_eligibility_plans(100)
             where order_id='order-6') then
    raise exception 'Initial case replay selected the same eligible tranche';
  end if;
  update public.ops_issues set severity='HIGH'
  where dedupe_key='settlement-eligible:30000000-0000-4000-8000-000000000008';
  update public.ops_issues set severity='CRITICAL'
  where dedupe_key='settlement-eligible:30000000-0000-4000-8000-000000000010';
  if exists (select 1 from public.list_due_settlement_eligibility_plans(100)
             where order_id in ('order-7','order-8','order-9','order-10')) then
    raise exception 'Escalated, resolved or not-yet-overdue case was selected again';
  end if;
  update public.order_settlement_plans set last_eligibility_scan_at=now()
  where order_id=(select order_id from public.list_due_settlement_eligibility_plans(1));
  if (select order_id from public.list_due_settlement_eligibility_plans(1)) = 'order-1' then
    raise exception 'A scanned plan did not rotate out of the first slot';
  end if;
  update public.order_settlement_tranches set status='ELIGIBLE'
  where id='30000000-0000-4000-8000-000000000001';
  insert into public.ops_issues(dedupe_key)
  values ('settlement-eligible:30000000-0000-4000-8000-000000000001');
  if exists (select 1 from public.list_due_settlement_eligibility_plans(100)
             where order_id='order-1') then
    raise exception 'The 14-day protection tranche was selected at 73 hours';
  end if;
end $$;
SQL
echo 'GREEN: due, future, frozen, missing-case, MEDIUM/HIGH escalation, resolved, access and rotation fixtures passed'

"${psql_cmd[@]}" < "$repo_root/supabase/migrations/rollback/20261111130000_due_settlement_eligibility_scan.rollback.sql" >/dev/null
"${psql_cmd[@]}" <<'SQL' >/dev/null
do $$
begin
  if to_regprocedure('public.list_due_settlement_eligibility_plans(integer)') is not null then
    raise exception 'Selector remained after rollback';
  end if;
  if to_regprocedure('public.list_due_settlement_eligibility_tranches(uuid)') is not null then
    raise exception 'Tranche selector remained after rollback';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='order_settlement_plans'
               and column_name='last_eligibility_scan_at') then
    raise exception 'Scan marker remained after rollback';
  end if;
end $$;
SQL
echo 'ROLLBACK: selector and scan marker removed'
