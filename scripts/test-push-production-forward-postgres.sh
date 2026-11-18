#!/usr/bin/env bash
set -euo pipefail

container="${PUSH_TEST_POSTGRES_CONTAINER:-codex-gate0-postgres17}"
database="push_forward_$$"
cleanup() {
  docker exec "$container" psql -U postgres -d postgres \
    -c "drop database if exists $database with (force)" >/dev/null || true
}
trap cleanup EXIT

for attempt in {1..30}; do
  if docker exec "$container" psql -U postgres -d postgres -c "select 1" >/dev/null 2>&1; then
    sleep 1
    break
  fi
  sleep 1
done
docker exec "$container" psql -U postgres -d postgres -c "create database $database" >/dev/null

docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" >/dev/null <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
create table public.job_queue (
  id uuid primary key default gen_random_uuid(),
  event_id uuid,
  job_type text not null,
  status text not null default 'PENDING',
  created_at timestamptz not null default now()
);
create table public.notification_delivery_outcomes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid,
  job_id uuid not null unique,
  channel text not null,
  recipient_user_id uuid,
  order_id uuid,
  status text not null,
  reason text,
  provider text,
  provider_reference text,
  metadata jsonb not null default '{}'::jsonb,
  terminal_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table public.push_tokens (
  id text primary key default gen_random_uuid()::text,
  user_id text not null,
  token text not null,
  platform text not null,
  device_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);
create table public.push_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  push_token_id text,
  status text not null,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);
create or replace function public.register_push_token(p_token text, p_platform text, p_device_id text)
returns public.push_tokens
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.push_tokens;
begin
  insert into public.push_tokens(user_id,token,platform,device_id)
  values (coalesce(auth.uid()::text,'00000000-0000-4000-8000-000000000001'),p_token,p_platform,p_device_id)
  on conflict (user_id,device_id) do update set token=excluded.token,platform=excluded.platform,updated_at=now()
  returning * into v_row;
  return v_row;
end $$;
SQL

for migration in \
  supabase/migrations/20261118023004_prod_forward_push_notification_schema.sql \
  supabase/migrations/20261118023124_prod_forward_push_notification_receipt_contract.sql \
  supabase/migrations/20261118023335_prod_forward_push_token_provenance.sql; do
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" < "$migration" >/dev/null
done

docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" >/dev/null <<'SQL'
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
insert into public.job_queue(id,job_type) values ('00000000-0000-4000-8000-000000000010','SEND_PUSH');
select public.record_notification_delivery_outcome(
  '00000000-0000-4000-8000-000000000010','PUSH','ACCEPTED',null,null,null,'EXPO','ticket-1','{}');
insert into public.push_delivery_attempts(notification_job_id,status,error_code,error_message)
values ('00000000-0000-4000-8000-000000000010','DELIVERY_ERROR','BadDeviceToken','Rejected by APNs');
do $$ begin
  if not exists (
    select 1 from public.notification_delivery_outcomes
    where job_id='00000000-0000-4000-8000-000000000010' and status='DEAD'
      and reason='BadDeviceToken'
  ) then raise exception 'push receipt trigger did not reconcile outcome'; end if;
end $$;
select public.register_push_token_with_provenance(
  'ExponentPushToken[forward-test]','ios','forward-device',
  '4729d6f8-273a-43a9-abdf-6e4ca31ce83d','development',
  'co.drapeon.app.dev','development');
insert into public.push_delivery_attempts(push_token_id,status,error_code,error_message)
select id,'DELIVERY_ERROR','BadDeviceToken','Rejected by APNs'
from public.push_tokens cross join generate_series(1,3)
where device_id='forward-device';
do $$ declare v_id text; begin
  select id into v_id from public.push_tokens where device_id='forward-device';
  if not public.quarantine_repeated_bad_device_token(v_id) then
    raise exception 'third confirmed device-token failure did not quarantine';
  end if;
end $$;
SQL

for rollback in \
  supabase/migrations/rollback/20261118023335_prod_forward_push_token_provenance.rollback.sql \
  supabase/migrations/rollback/20261118023124_prod_forward_push_notification_receipt_contract.rollback.sql \
  supabase/migrations/rollback/20261118023004_prod_forward_push_notification_schema.rollback.sql; do
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" < "$rollback" >/dev/null
done

echo 'production-forward push schema, receipt, provenance, and rollback passed'
