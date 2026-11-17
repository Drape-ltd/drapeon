#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-stale-payout-alert-$$"
logs="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$logs"; }
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null

schema="$repo_root/supabase/tests/dev_ops_sla_schedule_isolated_schema.sql"
migration="$repo_root/supabase/migrations/20261112213000_schedule_stale_payout_alert_scan.sql"
rollback="$repo_root/supabase/migrations/rollback/20261112213000_schedule_stale_payout_alert_scan.rollback.sql"
behavior="$repo_root/supabase/tests/stale_payout_alert_schedule_behavior.sql"
rollback_behavior="$repo_root/supabase/tests/stale_payout_alert_schedule_rollback_behavior.sql"

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$schema" >"$logs/schema.log"
if docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$behavior" >"$logs/red.log" 2>&1; then
  echo 'Expected missing alert-only schedule to fail.' >&2
  exit 1
fi
grep -q 'required alert-only payout cron is missing' "$logs/red.log"
echo 'RED: no stale-payout alert schedule exists.'

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$migration" >"$logs/forward.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$behavior" >"$logs/green.log" 2>&1
echo 'GREEN: one bounded ALERT_ONLY schedule exists.'

# A second application must stop rather than silently replace a reviewed schedule.
if docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$migration" >"$logs/replay.log" 2>&1; then
  echo 'Expected duplicate schedule application to stop.' >&2
  exit 1
fi
grep -q 'already exists' "$logs/replay.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$behavior" >"$logs/replay-check.log" 2>&1

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$rollback" >"$logs/rollback.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$rollback_behavior" >"$logs/rollback-check.log" 2>&1
echo 'ROLLBACK: alert-only schedule removed.'
