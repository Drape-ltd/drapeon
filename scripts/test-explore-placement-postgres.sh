#!/usr/bin/env bash
# Real-Postgres proof for the Explore placement migrations: RED on the live
# baseline, GREEN after 20261111150000/151000/152000, then exact rollback.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-explore-placement-$$"
logs="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$logs"; }
trap cleanup EXIT

m="$repo_root/supabase/migrations"
rb="$m/rollback"

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do docker exec "$container" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c \
  'create role anon nologin; create role authenticated nologin; create role service_role nologin;' >"$logs/roles.log"
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c 'create database placement;' >"$logs/db.log"
run_sql() { docker exec -i "$container" psql -U postgres -d placement -v ON_ERROR_STOP=1 "$@"; }

run_sql <"$repo_root/supabase/tests/explore_placement_isolated_schema.sql" >"$logs/schema.log"
# Baseline = the exact live definitions captured in the rollback files.
run_sql <"$rb/20261111151000_marketplace_placement_eligibility.rollback.sql" >"$logs/base-guard.log"
run_sql <"$rb/20261111152000_trust_approval_requires_placement.rollback.sql" >"$logs/base-approve.log"
run_sql <"$repo_root/supabase/tests/explore_placement_baseline_trigger.sql" >"$logs/trigger.log"

behavior="$repo_root/supabase/tests/explore_placement_behavior.sql"
if run_sql <"$behavior" >"$logs/red.log" 2>&1; then
  echo 'Expected the live baseline to fail the placement behaviour.' >&2; exit 1
fi
grep -q 'FAIL: approve without placement succeeded\|PLACEMENT' "$logs/red.log" || { tail -20 "$logs/red.log" >&2; exit 1; }
echo 'RED: the live baseline approves without a placement.'

# A legacy row keeps its data through the enum rename.
run_sql -c "insert into public.tailor_profiles (id, user_id, marketplace_category, supports_custom_orders) values ('10000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-0000000000ff', 'STREETWEAR', false);" >/dev/null

run_sql <"$m/20261111150000_rename_marketplace_ready_to_wear.sql" >"$logs/m1.log"
run_sql <"$m/20261111151000_marketplace_placement_eligibility.sql" >"$logs/m2.log"
run_sql <"$m/20261111152000_trust_approval_requires_placement.sql" >"$logs/m3.log"
[ "$(run_sql -At -c "select marketplace_category from public.tailor_profiles where id = '10000000-0000-0000-0000-0000000000ff'")" = "READY_TO_WEAR" ] \
  || { echo 'Legacy STREETWEAR row was not preserved as READY_TO_WEAR' >&2; exit 1; }
run_sql -c "delete from public.tailor_profiles where id = '10000000-0000-0000-0000-0000000000ff'" >/dev/null

run_sql <"$behavior" >"$logs/green.log" 2>&1 || { tail -30 "$logs/green.log" >&2; exit 1; }
grep -E 'NOTICE: +PASS:' "$logs/green.log"
# Replay: the migrations are re-runnable except the one-way enum rename.
run_sql <"$m/20261111151000_marketplace_placement_eligibility.sql" >/dev/null
run_sql <"$m/20261111152000_trust_approval_requires_placement.sql" >/dev/null
run_sql <"$behavior" >"$logs/replay.log" 2>&1 || { tail -30 "$logs/replay.log" >&2; exit 1; }
echo 'REPLAY: re-applying the function migrations keeps the same behaviour.'

run_sql <"$rb/20261111152000_trust_approval_requires_placement.rollback.sql" >"$logs/r3.log"
run_sql <"$rb/20261111151000_marketplace_placement_eligibility.rollback.sql" >"$logs/r2.log"
run_sql <"$rb/20261111150000_rename_marketplace_ready_to_wear.rollback.sql" >"$logs/r1.log"
labels="$(run_sql -At -c "select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'marketplace_category'")"
[ "$labels" = "TAILORING,STREETWEAR" ] || { echo "Rollback enum labels: $labels" >&2; exit 1; }
run_sql -At -c "insert into public.tailor_profiles (id, user_id) values ('10000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000aa'); select status from public.ops_decide_verification('00000000-0000-0000-0000-0000000000aa', 'APPROVE');" | grep -q VERIFIED \
  || { echo 'Rollback did not restore the four-argument approval' >&2; exit 1; }
echo 'ROLLBACK: enum label, guard, move function and four-argument approval restored.'
