#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-marketplace-category-$$"
logs="$(mktemp -d)"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$logs"
}
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c 'create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;' >"$logs/roles.log"
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c 'create database marketplace_category;' >"$logs/database.log"

schema="$repo_root/supabase/tests/marketplace_category_isolated_schema.sql"
migration="$repo_root/supabase/migrations/20261110050000_marketplace_category.sql"
behavior="$repo_root/supabase/tests/marketplace_category_behavior.sql"
rollback="$repo_root/supabase/migrations/rollback/20261110050000_marketplace_category.rollback.sql"

docker exec -i "$container" psql -U postgres -d marketplace_category -v ON_ERROR_STOP=1 <"$schema" >"$logs/schema.log"
docker exec -i "$container" psql -U postgres -d marketplace_category -v ON_ERROR_STOP=1 <"$migration" >"$logs/migration.log"
docker exec -i "$container" psql -U postgres -d marketplace_category -v ON_ERROR_STOP=1 <"$behavior" >"$logs/behavior.log"
grep 'PASS:' "$logs/behavior.log"

# The rollback is deliberately fail-closed while classifications or receipts exist.
if docker exec -i "$container" psql -U postgres -d marketplace_category -v ON_ERROR_STOP=1 <"$rollback" >"$logs/rollback-refused.log" 2>&1; then
  echo 'Rollback unexpectedly discarded marketplace decisions.' >&2
  exit 1
fi
grep 'Rollback refused' "$logs/rollback-refused.log" >/dev/null

docker exec "$container" psql -U postgres -d marketplace_category -v ON_ERROR_STOP=1 -c "update public.tailor_profiles set marketplace_category = 'TAILORING'; delete from public.marketplace_category_decisions;" >"$logs/rollback-prepare.log"
docker exec -i "$container" psql -U postgres -d marketplace_category -v ON_ERROR_STOP=1 <"$rollback" >"$logs/rollback.log"
docker exec "$container" psql -U postgres -d marketplace_category -v ON_ERROR_STOP=1 -Atc "select count(*) from pg_type where typname = 'marketplace_category';" | grep '^0$' >/dev/null
echo 'ROLLBACK: refused destructive rollback, then removed the schema after explicit cleanup.'
