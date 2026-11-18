#!/usr/bin/env bash
# Production-shaped rehearsal for the shared-order policy role-only repair.
# It proves that UUID and text baselines retain their exact predicate while
# only the policy role changes. A missing legacy policy is intentionally a
# no-op, matching Production's observed catalog state on 2026-11-18.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migration="$repo_root/supabase/migrations/20261117170000_production_shared_order_policy_authenticated.sql"
rollback="$repo_root/supabase/migrations/rollback/20261117170000_production_shared_order_policy_authenticated.rollback.sql"
container="drape-shared-order-policy-$$"
logs="$(mktemp -d)"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$logs"
}
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  docker exec "$container" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null
docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c 'create role authenticated nologin;' >/dev/null

run_sql() {
  local database="$1"
  shift
  docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 "$@"
}

create_database() {
  local database="$1"
  docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "create database ${database}" >/dev/null
}

policy_expression() {
  local database="$1"
  run_sql "$database" -At -c "
    select pg_get_expr(polqual, polrelid)
    from pg_policy
    where polrelid = 'public.tailor_profiles'::regclass
      and polname = 'customers: read tailor profile for shared orders'
  "
}

policy_roles() {
  local database="$1"
  run_sql "$database" -At -c "
    select coalesce(string_agg(r.rolname, ',' order by r.rolname), '')
    from pg_policy p
    left join pg_roles r on r.oid = any(p.polroles)
    where p.polrelid = 'public.tailor_profiles'::regclass
      and p.polname = 'customers: read tailor profile for shared orders'
  "
}

run_case() {
  local id_type="$1"
  local database="shared_order_${id_type}"
  create_database "$database"

  if [[ "$id_type" == "uuid" ]]; then
    run_sql "$database" <<'SQL' >/dev/null
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
create table public.tailor_profiles (id uuid primary key, user_id uuid not null);
create table public.orders (id uuid primary key, customer_id uuid not null, tailor_id uuid not null);
create policy "customers: read tailor profile for shared orders"
  on public.tailor_profiles for select to public
  using (exists (
    select 1 from public.orders
    where orders.tailor_id = tailor_profiles.user_id
      and orders.customer_id = (select auth.uid())
  ));
SQL
  else
    run_sql "$database" <<'SQL' >/dev/null
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
create table public.tailor_profiles (id text primary key, user_id text not null);
create table public.orders (id text primary key, customer_id text not null, tailor_id text not null);
create policy "customers: read tailor profile for shared orders"
  on public.tailor_profiles for select to public
  using (exists (
    select 1 from public.orders
    where orders.tailor_id = tailor_profiles.user_id
      and orders.customer_id = (select auth.uid())::text
  ));
SQL
  fi

  local before after roles
  before="$(policy_expression "$database")"
  run_sql "$database" <"$migration" >/dev/null
  after="$(policy_expression "$database")"
  roles="$(policy_roles "$database")"
  [[ "$before" == "$after" ]] || { echo "$id_type predicate changed" >&2; exit 1; }
  [[ "$roles" == "authenticated" ]] || { echo "$id_type roles were '$roles', expected authenticated" >&2; exit 1; }

  run_sql "$database" <"$migration" >/dev/null
  [[ "$(policy_expression "$database")" == "$before" ]] || { echo "$id_type replay changed predicate" >&2; exit 1; }
  [[ "$(policy_roles "$database")" == "authenticated" ]] || { echo "$id_type replay changed roles" >&2; exit 1; }

  run_sql "$database" <"$rollback" >/dev/null
  [[ "$(policy_expression "$database")" == "$before" ]] || { echo "$id_type rollback changed predicate" >&2; exit 1; }
  [[ "$(policy_roles "$database")" == "" ]] || { echo "$id_type rollback did not restore PUBLIC" >&2; exit 1; }
  echo "PASS: $id_type baseline preserves its predicate through apply, replay, and rollback."
}

run_case uuid
run_case text

create_database shared_order_missing
run_sql shared_order_missing <<'SQL' >/dev/null
create table public.tailor_profiles (id uuid primary key, user_id uuid not null);
SQL
run_sql shared_order_missing <"$migration" >/dev/null
missing_policy_count="$(run_sql shared_order_missing -At -c "select count(*) from pg_policy where polrelid = 'public.tailor_profiles'::regclass and polname = 'customers: read tailor profile for shared orders'")"
[[ "$missing_policy_count" == "0" ]] \
  || { echo 'Missing-policy baseline should remain a no-op.' >&2; exit 1; }
echo 'PASS: missing legacy policy remains a no-op.'
