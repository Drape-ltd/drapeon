#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-disputed-order-review-$$"
logs="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$logs"; }
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null

schema="$repo_root/supabase/tests/disputed_order_review_case_schema.sql"
live="$repo_root/supabase/migrations/rollback/20261113010000_disputed_order_review_case_ownership.rollback.sql"
forward="$repo_root/supabase/migrations/20261113010000_disputed_order_review_case_ownership.sql"
behavior="$repo_root/supabase/tests/disputed_order_review_case_behavior.sql"
rollback_behavior="$repo_root/supabase/tests/disputed_order_review_case_rollback.sql"

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$schema" >"$logs/schema.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$live" >"$logs/live.log"
if docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$behavior" >"$logs/red.log" 2>&1; then
  echo 'Expected the live function to reuse the unrelated push issue.' >&2
  exit 1
fi
grep -q 'unrelated push issue was returned as dispute review' "$logs/red.log"
echo 'RED: live function treats an unrelated push alert as dispute review ownership.'

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$forward" >"$logs/forward.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$behavior" >"$logs/green.log"
echo 'GREEN: distinct order review opens and replay returns the same receipt.'

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$live" >"$logs/rollback.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$rollback_behavior" >"$logs/rollback-check.log"
echo 'ROLLBACK: original live behavior restored.'
