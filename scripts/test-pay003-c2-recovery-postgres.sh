#!/usr/bin/env bash
# Rehearse exact PAY-003 2a-2c and readiness migration SQL on disposable PG17.
# The database and rows are synthetic; no provider or external service calls.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migrations="$repo_root/supabase/migrations"
fixture="$repo_root/supabase/tests/fixtures/pay003_c2_recovery_rehearsal.sql"
contract="$repo_root/supabase/tests/pay003_c2_recovery_rehearsal_contract.sql"
container="drape-pay003-c2-rehearsal-$$"
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
    || { tail -n 50 "$logs/$label.log" >&2; return 1; }
}

assert_phase() {
  local phase="$1"
  {
    printf "select set_config('drape.pay003_c2_phase', '%s', false);\n" "$phase"
    cat "$contract"
  } | run_sql >"$logs/assert-$phase.log" 2>&1 \
    || { tail -n 50 "$logs/assert-$phase.log" >&2; return 1; }
}

expect_phase_failure() {
  local phase="$1"
  local expected="$2"
  {
    printf "select set_config('drape.pay003_c2_phase', '%s', false);\n" "$phase"
    cat "$contract"
  } | run_sql >"$logs/red-$phase.log" 2>&1 && {
    echo "RED proof unexpectedly passed for $phase." >&2
    return 1
  }
  if ! rg -Fq "$expected" "$logs/red-$phase.log"; then
    echo "RED proof for $phase failed for an unexpected reason:" >&2
    tail -n 50 "$logs/red-$phase.log" >&2
    return 1
  fi
  echo "RED: $phase fails before its migration ($expected)."
}

run_transaction() {
  local label="$1"
  local migration="$2"
  local phase="$3"
  local ending="$4"
  {
    printf 'begin;\n'
    cat "$migration"
    printf "\nselect set_config('drape.pay003_c2_phase', '%s', true);\n" "$phase"
    cat "$contract"
    printf '\n%s;\n' "$ending"
  } | run_sql >"$logs/$label.log" 2>&1 \
    || { tail -n 70 "$logs/$label.log" >&2; return 1; }
}

run_contract_transaction() {
  local label="$1"
  local phase="$2"
  local ending="$3"
  {
    printf "begin;\nselect set_config('drape.pay003_c2_phase', '%s', true);\n" "$phase"
    cat "$contract"
    printf '\n%s;\n' "$ending"
  } | run_sql >"$logs/$label.log" 2>&1 \
    || { tail -n 70 "$logs/$label.log" >&2; return 1; }
}

run_readiness_transaction() {
  local label="$1"
  local ending="$2"
  {
    printf 'begin;\n'
    cat "$migrations/20261030154721_sync_stripe_payout_readiness.sql"
    cat <<'SQL'
set local role service_role;
select * from public.sync_stripe_payout_profile_readiness(
  'qa-profile-readiness','acct-ready',true,'US','2026-11-12 12:02:00+00'
);
do $$
declare r record;
begin
  select * into r from public.sync_stripe_payout_profile_readiness(
    'qa-profile-readiness','acct-ready',true,'US','2026-11-12 12:03:00+00'
  );
  if r.transitioned then raise exception 'identical readiness observation was not a no-op'; end if;
end
$$;
reset role;
SQL
    printf "select set_config('drape.pay003_c2_phase', 'readiness_green', true);\n"
    cat "$contract"
    printf '\n%s;\n' "$ending"
  } | run_sql >"$logs/$label.log" 2>&1 \
    || { tail -n 70 "$logs/$label.log" >&2; return 1; }
}

run_file baseline "$fixture"
run_file predecessor-returned-tranche "$migrations/20261028132120_phase3_snapshot_returned_tranche_ops.sql"
run_file predecessor-returned-tranche-trigger "$migrations/20261028132126_phase3_snapshot_returned_tranche_trigger.sql"
assert_phase baseline
echo 'BASELINE: PostgreSQL 17, minimal synthetic predecessor schema, prior returned-tranche trigger body, and two isolated payout rows.'

expect_phase_failure green_2a '2a guard function, transfer RPC, or enabled trigger is absent'
run_transaction rollback-2a "$migrations/20261030100000_c2_forward_only_payouts.sql" green_2a rollback
assert_phase baseline
run_transaction apply-2a "$migrations/20261030100000_c2_forward_only_payouts.sql" green_2a commit
assert_phase green_2a
echo '2a GREEN: exact guard and service-only transfer RPC installed; illegal FAILED -> PROCESSING fails closed.'

expect_phase_failure green_2b '2b did not restore the claim-backed destination and marker'
run_transaction rollback-2b "$migrations/20261030110000_c2_restore_payout_destinations.sql" green_2b rollback
assert_phase before_2b
run_transaction apply-2b "$migrations/20261030110000_c2_restore_payout_destinations.sql" green_2b commit
assert_phase green_2b
echo '2b GREEN: only the unambiguous destination backed by the immutable claim is restored and marked.'

expect_phase_failure green_2c '2c returned-funds permission boundary is absent'
run_transaction rollback-2c "$migrations/20261030120000_c2_returned_funds_forward_repair.sql" green_2c rollback
assert_phase rollback_2c
run_contract_transaction prove-red-2c red_2c rollback
assert_phase rollback_2c
echo '2c RED: predecessor leaves the PAID payout unreconciled despite confirmed returned-funds evidence.'
prior_guard_hash="$(run_sql -Atqc "select md5(pg_get_functiondef('public.guard_payout_forward_status()'::regprocedure))")"
prior_trigger_hash="$(run_sql -Atqc "select md5(pg_get_functiondef('private.sync_returned_snapshot_tranche_payout()'::regprocedure))")"
run_transaction apply-2c-rollback "$migrations/20261030120000_c2_returned_funds_forward_repair.sql" green_2c rollback
assert_phase rollback_2c
after_rollback_guard_hash="$(run_sql -Atqc "select md5(pg_get_functiondef('public.guard_payout_forward_status()'::regprocedure))")"
after_rollback_trigger_hash="$(run_sql -Atqc "select md5(pg_get_functiondef('private.sync_returned_snapshot_tranche_payout()'::regprocedure))")"
if [[ "$prior_guard_hash" != "$after_rollback_guard_hash" || "$prior_trigger_hash" != "$after_rollback_trigger_hash" ]]; then
  echo '2c transaction rollback did not restore exact predecessor function definitions.' >&2
  exit 1
fi
run_transaction apply-2c "$migrations/20261030120000_c2_returned_funds_forward_repair.sql" green_2c commit
assert_phase green_2c
echo '2c GREEN: exact provider-return evidence permits PAID -> FAILED, records one deduplicated Ops issue; rollback restored prior function hashes and data.'

expect_phase_failure readiness_green 'readiness RPC security mode, owner, search_path, or grants are wrong'
run_readiness_transaction rollback-readiness rollback
assert_phase readiness_rollback
run_readiness_transaction apply-readiness commit
assert_phase readiness_green
echo '20261030154721 GREEN: service-role-only readiness RPC passes the strict profile guard, preserves first-observed timestamp on replay, and transaction rollback removes function and profile change.'

echo 'LIMIT: pre-commit transaction rollback proofs on a minimal synthetic predecessor schema; after commit, recovery remains forward-only. No live Dev or Production database was changed.'
