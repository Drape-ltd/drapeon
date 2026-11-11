#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-ops-sla-$$"
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
migration="$repo_root/supabase/migrations/20261111140000_restore_dev_ops_sla_schedule.sql"
rollback="$repo_root/supabase/migrations/rollback/20261111140000_restore_dev_ops_sla_schedule.rollback.sql"
behavior="$repo_root/supabase/tests/dev_ops_sla_schedule_behavior.sql"
rollback_behavior="$repo_root/supabase/tests/dev_ops_sla_schedule_rollback_behavior.sql"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$schema" >"$logs/schema.log"

if docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$behavior" >"$logs/red.log" 2>&1; then
  echo 'Expected the absent schedule to fail the pre-fix assertion.' >&2
  exit 1
fi
grep -q 'required Dev SLA cron is missing' "$logs/red.log"
echo 'RED: required Dev SLA schedule is absent.'

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$migration" >"$logs/forward.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$behavior" >"$logs/green.log" 2>&1
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$migration" >"$logs/replay.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$behavior" >"$logs/replay-check.log" 2>&1
grep -E 'NOTICE: +PASS:' "$logs/green.log"
echo 'GREEN: forward repair and replay keep one job.'

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$rollback" >"$logs/rollback.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$rollback_behavior" >"$logs/rollback-check.log" 2>&1
grep -E 'NOTICE: +PASS:' "$logs/rollback-check.log"

# An already healthy schedule must survive both forward and rollback.
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c \
  "select cron.schedule('ops-slack-sla-reminders','27,57 * * * *','select public.enqueue_ops_slack_sla_reminders();')" >"$logs/prior.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$migration" >"$logs/prior-forward.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$rollback" >"$logs/prior-rollback.log"
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -tAc \
  "select count(*) from cron.job where jobname='ops-slack-sla-reminders' and command='select public.enqueue_ops_slack_sla_reminders();'" >"$logs/prior-check.log"
grep -qx '1' "$logs/prior-check.log"

# The migration is Dev-only. Production-mode application changes no schedule.
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c \
  "delete from cron.job where jobname='ops-slack-sla-reminders'" >"$logs/clear.log"
{ printf "set drape.test_ops_environment='PRODUCTION';\n"; cat "$migration"; } \
  | docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >"$logs/prod.log"
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -tAc \
  "select count(*) from cron.job" >"$logs/prod-check.log"
grep -qx '0' "$logs/prod-check.log"
echo 'ROLLBACK: created job removed, prior job preserved, Production unchanged.'
