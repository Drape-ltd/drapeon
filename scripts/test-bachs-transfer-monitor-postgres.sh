#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-bachs-transfer-monitor-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < "$repo_root/supabase/tests/bachs_transfer_monitor_local.sql" >/dev/null
BACHS_MONITOR_TEST_CONTAINER="$container" deno run --allow-env=BACHS_MONITOR_TEST_CONTAINER --allow-run=docker "$repo_root/supabase/tests/bachs_transfer_monitor_local_test.ts"
