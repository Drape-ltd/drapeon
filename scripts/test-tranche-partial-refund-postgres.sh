#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-tranche-$$"
logs="$(mktemp -d)"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$logs"
}
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly \
  -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c \
  'create role anon nologin; create role authenticated nologin; create role service_role nologin;' \
  >"$logs/roles.log"
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c \
  'create database tranche;' >"$logs/database.log"

schema="$repo_root/supabase/tests/tranche_partial_refund_isolated_schema.sql"
migration="$repo_root/supabase/migrations/20261110042832_allow_accounted_non_tailor_refunds_for_tranches.sql"
rollback="$repo_root/supabase/migrations/rollback/20261110042832_allow_accounted_non_tailor_refunds_for_tranches.rollback.sql"
behavior="$repo_root/supabase/tests/tranche_partial_refund_behavior.sql"
docker exec -i "$container" psql -U postgres -d tranche -v ON_ERROR_STOP=1 \
  <"$schema" >"$logs/schema.log"

# The rollback contains the exact pre-fix live bodies. Its final DROP is
# omitted when installing those baseline bodies in a fresh database.
sed '/^drop function payment_internal.tranche_source_payment_available/d' "$rollback" |
  docker exec -i "$container" psql -U postgres -d tranche -v ON_ERROR_STOP=1 \
  >"$logs/baseline.log"
if docker exec -i "$container" psql -U postgres -d tranche -v ON_ERROR_STOP=1 \
  <"$behavior" >"$logs/red.log" 2>&1; then
  echo 'Expected the baseline partial-refund reservation to fail.' >&2
  exit 1
fi
if ! grep -q 'Tranche source payment is not fully available' "$logs/red.log"; then
  tail -15 "$logs/red.log" >&2
  exit 1
fi
echo 'RED: live baseline blocks the accounted fulfillment refund.'

docker exec -i "$container" psql -U postgres -d tranche -v ON_ERROR_STOP=1 \
  <"$migration" >"$logs/migration.log"
docker exec -i "$container" psql -U postgres -d tranche -v ON_ERROR_STOP=1 \
  <"$behavior" >"$logs/green.log" 2>&1
grep -E 'NOTICE: +PASS:' "$logs/green.log"
echo 'GREEN: reservation, safety gates, finalization and replay passed.'

docker exec -i "$container" psql -U postgres -d tranche -v ON_ERROR_STOP=1 \
  <"$rollback" >"$logs/rollback.log"
if docker exec -i "$container" psql -U postgres -d tranche -v ON_ERROR_STOP=1 \
  <"$behavior" >"$logs/rollback-red.log" 2>&1; then
  echo 'Rollback did not restore the baseline rejection.' >&2
  exit 1
fi
if ! grep -q 'Tranche source payment is not fully available' "$logs/rollback-red.log"; then
  tail -15 "$logs/rollback-red.log" >&2
  exit 1
fi
echo 'ROLLBACK: exact live bodies restored the baseline result.'
