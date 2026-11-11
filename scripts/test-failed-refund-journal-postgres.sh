#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-refund-failure-$$"
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
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c \
  'create role anon nologin; create role authenticated nologin; create role service_role nologin;' \
  >"$logs/roles.log"
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c \
  'create database refund_failure;' >"$logs/database.log"

run_sql() {
  docker exec -i "$container" psql -U postgres -d refund_failure -v ON_ERROR_STOP=1
}

run_sql <"$repo_root/supabase/tests/tranche_partial_refund_isolated_schema.sql" >"$logs/schema.log"
cat <<'SQL' | run_sql >"$logs/constraints.log"
create extension if not exists pgcrypto;
alter table public.commercial_ledger_transactions alter column id set default gen_random_uuid();
alter table public.commercial_ledger_transactions add primary key (id);
create unique index on public.commercial_ledger_transactions(idempotency_key);
alter table public.commercial_ledger_entries alter column id set default gen_random_uuid();
SQL
awk '/^create or replace function public.post_commercial_ledger_transaction\(/ { on=1 } on { print } on && /^\$\$;$/ { exit }' \
  "$repo_root/supabase/migrations/20260731140000_commercial_ledger_pricing_foundation.sql" |
  run_sql >"$logs/post-function.log"
run_sql <"$repo_root/supabase/migrations/rollback/20261111120000_reverse_failed_refund_journal.rollback.sql" \
  >"$logs/baseline.log"
docker exec "$container" psql -U postgres -d refund_failure -At -c \
  "select md5(pg_get_functiondef('public.reconcile_failed_order_payment_refund(uuid,text,jsonb)'::regprocedure)), md5(pg_get_functiondef('payment_internal.tranche_source_payment_available(uuid,uuid,uuid)'::regprocedure))" \
  >"$logs/baseline-hashes.log"
echo "Baseline function hashes: $(cat "$logs/baseline-hashes.log")"

behavior="$repo_root/supabase/tests/failed_refund_journal_reversal_behavior.sql"
if run_sql <"$behavior" >"$logs/red.log" 2>&1; then
  echo 'Expected the current refund failure code to leave a false journal.' >&2
  exit 1
fi
if ! grep -q 'FAILED_REFUND_JOURNAL_NOT_REVERSED' "$logs/red.log"; then
  tail -20 "$logs/red.log" >&2
  exit 1
fi
echo 'RED: current code restores payment status but leaves the refund journal.'

run_sql <"$repo_root/supabase/migrations/20261111120000_reverse_failed_refund_journal.sql" \
  >"$logs/migration.log"
run_sql <"$behavior" >"$logs/green.log" 2>&1
grep -E 'NOTICE: +PASS:' "$logs/green.log"

run_sql <"$repo_root/supabase/migrations/rollback/20261111120000_reverse_failed_refund_journal.rollback.sql" \
  >"$logs/rollback.log"
if run_sql <"$behavior" >"$logs/rollback-red.log" 2>&1; then
  echo 'Rollback did not restore the old refund failure behavior.' >&2
  exit 1
fi
if ! grep -q 'FAILED_REFUND_JOURNAL_NOT_REVERSED' "$logs/rollback-red.log"; then
  tail -20 "$logs/rollback-red.log" >&2
  exit 1
fi
echo 'ROLLBACK: the old live functions again leave the refund journal.'
