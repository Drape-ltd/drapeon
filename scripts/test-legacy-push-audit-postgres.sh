#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-push-audit-$$"
logs="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$logs"; }
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null

schema="$repo_root/supabase/tests/legacy_push_audit_isolated_schema.sql"
migration="$repo_root/supabase/migrations/20261110173730_reconcile_legacy_push_delivery_audit.sql"
rollback="$repo_root/supabase/migrations/rollback/20261110173730_reconcile_legacy_push_delivery_audit.rollback.sql"
behavior="$repo_root/supabase/tests/legacy_push_audit_behavior.sql"
rollback_behavior="$repo_root/supabase/tests/legacy_push_audit_rollback_behavior.sql"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$schema" >"$logs/schema.log"

if docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$behavior" >"$logs/red.log" 2>&1; then
  echo 'Expected the legacy false-delivery assertion to fail on main.' >&2
  exit 1
fi
grep -q 'unique failed receipt should be DEAD' "$logs/red.log"
echo 'RED: main falsely reports the failed push as delivered.'

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$migration" >"$logs/migration.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$behavior" >"$logs/green.log" 2>&1
grep -E 'NOTICE: +PASS:' "$logs/green.log"

# A second apply must be harmless. The rollout is a data correction, not a resend.
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$migration" >"$logs/replay.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$behavior" >"$logs/replay-check.log" 2>&1
echo 'GREEN: repair and replay passed without a notification send.'

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$rollback" >"$logs/rollback.log"
if docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$behavior" >"$logs/rollback-red.log" 2>&1; then
  echo 'Rollback did not restore the legacy assertion.' >&2
  exit 1
fi
grep -q 'unique failed receipt should be DEAD' "$logs/rollback-red.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$rollback_behavior" >"$logs/rollback-check.log" 2>&1
grep -E 'NOTICE: +PASS:' "$logs/rollback-check.log"
echo 'ROLLBACK: previous rows and receipt links restored.'
