#!/usr/bin/env bash
set -euo pipefail

container="${PUSH_TEST_POSTGRES_CONTAINER:-codex-gate0-postgres17}"
database="push_provenance_$$"
cleanup() { docker exec "$container" psql -U postgres -d postgres -c "drop database if exists $database with (force)" >/dev/null; }
trap cleanup EXIT
for attempt in {1..30}; do
  if docker exec "$container" psql -U postgres -d postgres -c "select 1" >/dev/null 2>&1; then
    # The image briefly exposes a bootstrap server before its final restart.
    sleep 2
    if docker exec "$container" psql -U postgres -d postgres -c "select 1" >/dev/null 2>&1; then break; fi
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
create table public.push_tokens (
  id text primary key default gen_random_uuid()::text,
  user_id text not null,
  token text not null,
  platform text not null,
  device_id text not null,
  created_at timestamp without time zone not null default now(),
  updated_at timestamp without time zone not null default now(),
  unique (user_id, device_id)
);
create table public.push_delivery_attempts (
  id text primary key,
  push_token_id text,
  status text,
  error_code text,
  error_message text
  ,created_at timestamptz not null default now()
);
SQL
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" +  < supabase/migrations/20260719173000_push_token_rpc_rebind_installation.sql >/dev/null
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" +  < supabase/migrations/20261112003354_push_token_provenance_and_bad_token_quarantine.sql >/dev/null

docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" >/dev/null <<'SQL'
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select public.register_push_token_with_provenance(
  'ExponentPushToken[test-one]', 'ios', 'install-one',
  '4729d6f8-273a-43a9-abdf-6e4ca31ce83d',
  'development', 'co.drapeon.app.dev', 'development');
do $$
begin
  if not exists (select 1 from public.push_tokens where device_id='install-one'
                 and app_variant='development' and apns_environment='development') then
    raise exception 'provenance was not recorded';
  end if;
end $$;
insert into public.push_delivery_attempts(id,push_token_id,status,error_code,error_message)
select n::text, token.id, 'DELIVERY_ERROR', 'DeveloperError', 'BadDeviceToken'
from public.push_tokens token cross join generate_series(1,2) n
where token.device_id='install-one';
do $$
declare v_id text;
begin
  select id into v_id from public.push_tokens where device_id='install-one';
  if public.quarantine_repeated_bad_device_token(v_id) then
    raise exception 'quarantined before third failure';
  end if;
end $$;
insert into public.push_delivery_attempts(id,push_token_id,status,error_code,error_message)
select '3', id, 'DELIVERY_ERROR', 'BadDeviceToken', 'Rejected by APNs'
from public.push_tokens where device_id='install-one';
do $$
declare v_id text;
begin
  select id into v_id from public.push_tokens where device_id='install-one';
  if not public.quarantine_repeated_bad_device_token(v_id) then
    raise exception 'third failure did not quarantine token';
  end if;
end $$;
select public.register_push_token('ExponentPushToken[test-one]', 'ios', 'install-one');
do $$
begin
  if not exists (select 1 from public.push_tokens where device_id='install-one'
                 and quarantined_at is not null) then
    raise exception 'same token cleared quarantine';
  end if;
end $$;
select public.register_push_token('ExponentPushToken[test-two]', 'ios', 'install-one');
do $$
begin
  if not exists (select 1 from public.push_tokens where device_id='install-one'
                 and quarantined_at is null and token='ExponentPushToken[test-two]'
                 and expo_project_id is null) then
    raise exception 'new token did not clear quarantine';
  end if;
end $$;
do $$
declare v_id text;
begin
  select id into v_id from public.push_tokens where device_id='install-one';
  if public.quarantine_repeated_bad_device_token(v_id) then
    raise exception 'old token failures quarantined a new token';
  end if;
end $$;
SQL
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" +  < supabase/rollback/20261112003354_push_token_provenance_and_bad_token_quarantine_rollback.sql >/dev/null
echo 'push token provenance, quarantine, and rollback passed'
