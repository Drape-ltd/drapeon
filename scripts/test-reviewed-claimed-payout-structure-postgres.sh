#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-reviewed-retry-structure-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create role anon;
create role authenticated;
create role service_role;
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/reviewed_claimed_payout_retry_isolated_schema.sql" >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create table public.money_desk_requests(id uuid primary key);
alter table public.payout_provider_operations
  add constraint payout_provider_operations_check check (
    (operation_number=1 and reviewed_correction_id is null and money_desk_request_id is null)
    or (operation_number>1 and reviewed_correction_id is not null and money_desk_request_id is not null)
  );
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/migrations/20261110095223_reviewed_claimed_payout_retry.sql" >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/reviewed_claimed_payout_retry_structure.sql"
