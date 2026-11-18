#!/usr/bin/env bash
set -euo pipefail

container="drape-push-forward-repair-$$"
logs="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$logs"; }
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >"$logs/schema.log" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
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
  error_message text,
  created_at timestamptz not null default now()
);
SQL

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <supabase/migrations/20260719173000_push_token_rpc_rebind_installation.sql >>"$logs/base.log"

# Production-like path: the historical provenance migration is absent.
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <supabase/migrations/20261118024208_forward_install_push_token_quarantine_schema.sql >>"$logs/forward.log"
# Fresh-main path: running the forward repair over an already-complete schema is harmless.
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <supabase/migrations/20261118024208_forward_install_push_token_quarantine_schema.sql >>"$logs/idempotent.log"

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >"$logs/assertions.log" <<'SQL'
do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema='public' and table_name='push_tokens'
        and column_name in ('expo_project_id','app_variant','application_id','apns_environment',
                            'token_generation_started_at','quarantined_at','quarantine_reason')) <> 7 then
    raise exception 'forward repair did not install all push token columns';
  end if;
  if to_regprocedure('public.register_push_token_with_provenance(text,text,text,text,text,text,text)') is null
     or to_regprocedure('public.quarantine_repeated_bad_device_token(text)') is null then
    raise exception 'forward repair did not install the push token RPCs';
  end if;
  if (select count(*) from pg_trigger
      where tgrelid='public.push_tokens'::regclass
        and tgname='push_tokens_reset_quarantine_on_token_change' and not tgisinternal) <> 1 then
    raise exception 'forward repair did not install exactly one reset trigger';
  end if;
end
$$;
select 'push_token_forward_repair_passed';
SQL
grep -q 'push_token_forward_repair_passed' "$logs/assertions.log"
echo 'GREEN: push-token forward repair installs the missing schema and is idempotent.'
