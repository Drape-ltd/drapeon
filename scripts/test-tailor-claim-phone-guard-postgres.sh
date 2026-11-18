#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-tailor-claim-phone-guard-$$"
logs="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$logs"; }
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tailor_claim_phone_guard_isolated_schema.sql" >"$logs/schema.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/migrations/20261118212546_guard_tailor_claim_phone_before_auth.sql" >"$logs/migration.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tailor_claim_phone_guard_behavior.sql" >"$logs/behavior.log" 2>&1
grep -q 'tailor_claim_phone_guard_fresh_postgres_passed' "$logs/behavior.log"
echo 'GREEN: Stage 4 phone guard and post-handover correction pass on fresh Postgres 17.'
