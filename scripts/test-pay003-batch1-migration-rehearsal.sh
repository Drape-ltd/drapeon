#!/usr/bin/env bash
# Reproducible pre-commit rollback and exact-file replay proof for PAY-003 1a-1d.
# Uses a disposable PostgreSQL 17 container and synthetic, isolated rows only.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migrations="$repo_root/supabase/migrations"
fixture="$repo_root/supabase/tests/fixtures/pay003_batch1_migration_rehearsal.sql"
contract="$repo_root/supabase/tests/pay003_batch1_rehearsal_contract.sql"
container="drape-pay003-rehearsal-$$"
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

run_sql() {
  docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

run_file() {
  local label="$1"
  local file="$2"
  run_sql <"$file" >"$logs/$label.log" 2>&1 \
    || { tail -n 40 "$logs/$label.log" >&2; return 1; }
}

assert_phase() {
  local phase="$1"
  {
    printf "select set_config('drape.pay003_rehearsal_phase', '%s', false);\n" "$phase"
    cat "$contract"
  } | run_sql >"$logs/assert-$phase.log" 2>&1 \
    || { tail -n 40 "$logs/assert-$phase.log" >&2; return 1; }
}

run_transaction() {
  local label="$1"
  local migration="$2"
  local phase="$3"
  local ending="$4"
  {
    printf 'begin;\n'
    cat "$migration"
    printf "\nselect set_config('drape.pay003_rehearsal_phase', '%s', true);\n" "$phase"
    cat "$contract"
    printf '\n%s;\n' "$ending"
  } | run_sql >"$logs/$label.log" 2>&1 \
    || { tail -n 60 "$logs/$label.log" >&2; return 1; }
}

run_file baseline "$fixture"
assert_phase baseline
echo 'BASELINE: disposable Dev-shaped predecessor schema and one synthetic legacy refund.'

run_transaction rollback-1a "$migrations/20261029233955_fix_ready_made_route_snapshot_service_role.sql" a1 rollback
assert_phase baseline
run_transaction apply-1a "$migrations/20261029233955_fix_ready_made_route_snapshot_service_role.sql" a1 commit
assert_phase a1
echo '1a: transaction rollback restores the predecessor; exact migration applies with service-only execution.'

run_transaction rollback-1b-schema "$migrations/20261030030000_pay003_forward_only_payment_status.sql" a1b rollback
assert_phase rollback_1b
run_transaction apply-1b-schema "$migrations/20261030030000_pay003_forward_only_payment_status.sql" a1b commit
assert_phase a1b
run_transaction rollback-1b-refund "$migrations/20261030040000_pay003_refund_failure_reversal.sql" a1b4 rollback
assert_phase rollback_1b4
run_transaction apply-1b-refund "$migrations/20261030040000_pay003_refund_failure_reversal.sql" a1b4 commit
assert_phase a1b4
echo '1b: both files apply in order, each in its own transaction; rollback restores introduced objects and the replaced function signature.'

run_transaction rollback-1c "$migrations/20261030050000_pay003_legacy_refund_baseline.sql" a1c rollback
assert_phase rollback_1c
run_transaction apply-1c "$migrations/20261030050000_pay003_legacy_refund_baseline.sql" a1c commit
assert_phase a1c
echo '1c: transaction rollback removes the synthetic baseline row; commit seeds exactly one row.'

before_guard_hash="$(run_sql -Atqc "select md5(pg_get_functiondef('public.guard_order_payment_forward_status()'::regprocedure))")"
run_transaction rollback-1d "$migrations/20261030060000_pay003_refund_aggregate_hardening.sql" a1d rollback
after_guard_hash="$(run_sql -Atqc "select md5(pg_get_functiondef('public.guard_order_payment_forward_status()'::regprocedure))")"
if [[ "$before_guard_hash" != "$after_guard_hash" ]]; then
  echo '1d transaction rollback did not restore the predecessor function definition.' >&2
  exit 1
fi
run_transaction apply-1d "$migrations/20261030060000_pay003_refund_aggregate_hardening.sql" a1d commit
assert_phase a1d
echo '1d: transaction rollback restores the predecessor function hash; exact hardening applies.'

# The 1a, 1c and 1d files are replayed in separate transactions. The data-only
# 1c replay must remain a no-op because its provider/refund identity is present.
run_transaction replay-1a "$migrations/20261029233955_fix_ready_made_route_snapshot_service_role.sql" a1 commit
run_transaction replay-1c "$migrations/20261030050000_pay003_legacy_refund_baseline.sql" a1c commit
run_transaction replay-1d "$migrations/20261030060000_pay003_refund_aggregate_hardening.sql" a1d commit
assert_phase a1d
echo 'REPLAY: 1a, data-only 1c and compatible hardening 1d replay individually; the legacy refund count stays at one.'
echo 'LIMIT: this proves pre-commit transaction rollback only. Post-commit recovery remains forward-only.'
