#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-reviewed-refund-$$"
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
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c \
  'create role anon nologin; create role authenticated nologin; create role service_role nologin;' >/dev/null
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c \
  'create database reviewed_refund;' >/dev/null
run_sql() {
  docker exec -i "$container" psql -U postgres -d reviewed_refund -v ON_ERROR_STOP=1
}

run_sql <"$repo_root/supabase/tests/tranche_partial_refund_isolated_schema.sql" >"$logs/schema.log"
cat <<'SQL' | run_sql >"$logs/setup.log"
create extension if not exists pgcrypto;
alter table public.commercial_ledger_transactions alter column id set default gen_random_uuid();
alter table public.commercial_ledger_transactions add primary key (id);
create unique index on public.commercial_ledger_transactions(idempotency_key);
alter table public.commercial_ledger_entries alter column id set default gen_random_uuid();
create table public.money_desk_decisions (
  request_id uuid, decision text, approver_subject text
);
create table public.financial_cases (id uuid primary key);
insert into public.financial_cases (id)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
alter table public.money_desk_requests
  add constraint money_desk_requests_case_id_fkey
  foreign key (case_id) references public.financial_cases(id);
create table public.money_desk_execution_attempts (
  id uuid primary key, request_id uuid, status text,
  executor_email text, executor_role text, provider_reference text,
  failure_code text, failure_summary text, completed_at timestamptz
);
create table public.money_desk_events (
  request_id uuid, event_type text, actor_email text, actor_role text,
  payload jsonb, correlation_id uuid
);
create table public.ops_case_events (
  issue_id uuid, event_type text, visibility text, sensitivity text,
  actor_label text, from_status text, to_status text, summary text,
  payload jsonb, idempotency_key text, correlation_id uuid, occurred_at timestamptz,
  unique(issue_id,idempotency_key)
);
create table public.ops_audit_logs (
  issue_id uuid, action_taken text, performed_by text, performed_role text,
  reason text, before_state jsonb, after_state jsonb
);
SQL
awk '/^create or replace function public.post_commercial_ledger_transaction\(/ { on=1 } on { print } on && /^\$\$;$/ { exit }' \
  "$repo_root/supabase/migrations/20260731140000_commercial_ledger_pricing_foundation.sql" |
  run_sql >"$logs/post.log"
awk '/^create or replace function public.complete_money_desk_execution\(/ { on=1 } on { print } on && /^\$\$;$/ { exit }' \
  "$repo_root/supabase/migrations/20260801010000_money_desk_security_approvals.sql" |
  run_sql >"$logs/complete.log"

behavior="$repo_root/supabase/tests/reviewed_failed_refund_journal_recovery_behavior.sql"
if run_sql <"$behavior" >"$logs/red.log" 2>&1; then
  echo 'Expected main to lack the reviewed historical recovery.' >&2
  exit 1
fi
grep -q 'complete_reviewed_failed_refund_journal_recovery' "$logs/red.log"
echo 'RED: historical failed refund has no reviewed recovery on main.'

run_sql <"$repo_root/supabase/migrations/20261111160000_reviewed_failed_refund_journal_recovery.sql" >"$logs/migration.log"
if run_sql <"$behavior" >"$logs/binding-red.log" 2>&1; then
  echo 'Expected the old finalizer to reject a valid request with no financial case.' >&2
  exit 1
fi
grep -q 'FAILED_REFUND_CASE_MISMATCH' "$logs/binding-red.log"
echo 'RED: old finalizer rejects the real Money Desk case binding.'

run_sql <"$repo_root/supabase/migrations/20261111183000_failed_refund_journal_ops_issue_binding.sql" >"$logs/binding-migration.log"
run_sql <"$behavior" >"$logs/green.log" 2>&1 || {
  tail -35 "$logs/green.log" >&2
  exit 1
}
grep -E 'NOTICE: +PASS:' "$logs/green.log"

run_sql <"$repo_root/supabase/migrations/rollback/20261111183000_failed_refund_journal_ops_issue_binding.rollback.sql" >"$logs/binding-rollback.log"
if run_sql <"$behavior" >"$logs/binding-rollback-red.log" 2>&1; then
  echo 'Rollback left the corrected case binding active.' >&2
  exit 1
fi
grep -q 'FAILED_REFUND_CASE_MISMATCH' "$logs/binding-rollback-red.log"
echo 'ROLLBACK: prior case binding rejects the valid request again.'

run_sql <"$repo_root/supabase/migrations/rollback/20261111160000_reviewed_failed_refund_journal_recovery.rollback.sql" >"$logs/rollback.log"
if run_sql <"$behavior" >"$logs/rollback-red.log" 2>&1; then
  echo 'Rollback left the reviewed recovery callable.' >&2
  exit 1
fi
grep -q 'complete_reviewed_failed_refund_journal_recovery' "$logs/rollback-red.log"
echo 'ROLLBACK: reviewed recovery is unavailable again.'
