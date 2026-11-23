#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-definite-tranche-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create extension if not exists pgcrypto;
create schema private;
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tranche_partial_refund_isolated_schema.sql" >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
alter table public.ops_issues alter column id set default gen_random_uuid();
create unique index ops_issues_fixture_dedupe on public.ops_issues(dedupe_key);
create table public.payout_attempts (
  id uuid primary key, claim_id uuid, claim_operation_id uuid,
  attempt_number integer, status text, provider_evidence jsonb,
  completed_at timestamptz
);
SQL
source_migration="$repo_root/supabase/migrations/20261030120000_c2_returned_funds_forward_repair.sql"
awk '/^create or replace function public.guard_payout_forward_status\(\)/{copy=1} copy{print} copy && /^\$\$;/{exit}' \
  "$source_migration" | docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
awk '/^create or replace function private.sync_returned_snapshot_tranche_payout\(\)/{copy=1} copy{print} copy && /^\$\$;/{exit}' \
  "$source_migration" | docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
awk '/^create or replace function public.prevent_payout_provider_operation_identity_change\(\)/{copy=1} copy{print} copy && /^\$\$;/{exit}' \
  "$repo_root/supabase/migrations/20261102204053_bind_claimed_stripe_source_charge.sql" |
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
awk 'tolower($0) ~ /^create or replace function public.prevent_provider_operation_evidence_rewrite\(\)/{copy=1} copy{print} copy && /^end \$function\$;/{exit}' \
  "$repo_root/supabase/migrations/20261029001500_phase3_provider_operation_guards_forward.sql" |
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create trigger payout_forward_status_guard before update on public.payouts
  for each row execute function public.guard_payout_forward_status();
create trigger payout_claim_sync_returned_snapshot_tranche
  after update of status,transfer_status on public.payout_claims
  for each row execute function private.sync_returned_snapshot_tranche_payout();
create trigger payout_provider_operation_identity_immutable
  before update on public.payout_provider_operations
  for each row execute function public.prevent_payout_provider_operation_identity_change();
create trigger payout_provider_operation_evidence_immutable
  before update on public.payout_provider_operations
  for each row execute function public.prevent_provider_operation_evidence_rewrite();
SQL

rollback_file="$repo_root/supabase/migrations/rollback/20261110140000_finalise_definite_rejected_tranche.rollback.sql"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$rollback_file" >/dev/null
baseline_hash=$(docker exec "$container" psql -U postgres -At -c \
  "select md5(pg_get_functiondef('public.reconcile_definite_payout_rejection(uuid,uuid,jsonb)'::regprocedure))")
fixture="$repo_root/supabase/tests/definite_tranche_rejection_behavior.sql"
red_log=$(mktemp)
trap 'rm -f "$red_log"; cleanup' EXIT
if docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$fixture" >"$red_log" 2>&1; then
  echo 'Baseline unexpectedly closed the rejected tranche' >&2
  exit 1
fi
if ! grep -q 'Definite rejection left a tranche or payout open' "$red_log"; then
  tail -20 "$red_log" >&2
  exit 1
fi
echo 'RED: current-main function leaves the rejected tranche or payout open'

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/migrations/20261110140000_finalise_definite_rejected_tranche.sql" >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$fixture"
echo 'GREEN: definite rejection, ambiguous result, replay and adjacent state pass'

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$rollback_file" >/dev/null
rollback_hash=$(docker exec "$container" psql -U postgres -At -c \
  "select md5(pg_get_functiondef('public.reconcile_definite_payout_rejection(uuid,uuid,jsonb)'::regprocedure))")
if [[ "$baseline_hash" != "$rollback_hash" ]]; then
  echo 'Rollback did not restore the exact live function body' >&2
  exit 1
fi
echo 'ROLLBACK: exact live function body restored'
