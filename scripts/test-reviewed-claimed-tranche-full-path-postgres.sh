#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container=drape-reviewed-integrated-$$
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c 'select 1' \
      >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c \
  'create role anon; create role authenticated; create role service_role;' >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tranche_partial_refund_isolated_schema.sql" >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
alter table public.payout_claims add primary key (id);
alter table public.money_desk_requests add primary key (id);
alter table public.payout_provider_operations add primary key (id);
alter table public.payouts add primary key (id);
alter table public.order_settlement_tranches add primary key (id);
alter table public.order_payments add primary key (id);
alter table public.orders add primary key (id);
alter table public.payout_provider_operations add constraint payout_provider_operations_check
  check ((operation_number=1 and reviewed_correction_id is null and money_desk_request_id is null)
    or (operation_number>1 and reviewed_correction_id is not null and money_desk_request_id is not null));
create table public.money_desk_decisions(
  request_id uuid,decision text,approver_subject text,approver_email text
);
create table public.disputes(order_id uuid,status text);
create table public.provider_disputes(order_id text,money_movement_blocked boolean);
create table public.money_desk_execution_attempts(
  id uuid primary key default gen_random_uuid(),request_id uuid,status text,
  executor_email text,executor_role text,provider_reference text,
  failure_code text,failure_summary text,completed_at timestamptz
);
create table public.money_desk_events(
  request_id uuid,event_type text,actor_email text,actor_role text,
  payload jsonb,correlation_id uuid
);
create table public.payout_destination_corrections(
  id uuid primary key,claim_id uuid,failed_payout_id uuid,
  money_desk_request_id uuid,order_id text,tailor_profile_id text,
  provider text,operation_number integer,replacement_destination_id uuid,
  previous_destination_fingerprint text,replacement_destination_fingerprint text
);
create table public.payout_attempts(
  id uuid primary key default gen_random_uuid(),claim_id uuid,
  attempt_number integer,claim_operation_id uuid,status text,
  provider_operation_id text,provider_evidence jsonb default '{}'::jsonb,
  completed_at timestamptz,created_at timestamptz default now()
);
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/migrations/20261110042832_allow_accounted_non_tailor_refunds_for_tranches.sql" >/dev/null
correction_migration="${REVIEWED_CORRECTION_MIGRATION:-$repo_root/supabase/migrations/20261110120000_allow_reviewed_tranche_destination_correction.sql}"
guard_before=''
if [[ -f "$correction_migration" ]]; then
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
    <"$correction_migration" >/dev/null
  docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c \
    'create trigger a0_claimed_replacement_refund_race_guard before insert on public.payout_provider_operations for each row execute function public.guard_claimed_replacement_against_refund();' >/dev/null
  guard_before=$(docker exec "$container" psql -U postgres -At -c \
    "select md5(pg_get_functiondef('public.guard_claimed_replacement_against_refund()'::regprocedure))")
fi
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/migrations/20261110130000_reviewed_claimed_payout_retry.sql"
awk '/^create or replace function public.complete_money_desk_execution\(/{copy=1} copy{print} copy && /^\$\$;/{exit}' \
  "$repo_root/supabase/migrations/20260801010000_money_desk_security_approvals.sql" |
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
fixture=$(mktemp)
trap 'rm -f "$fixture"; cleanup' EXIT
awk '/^do \$safety\$/{exit} {print}' \
  "$repo_root/supabase/tests/tranche_partial_refund_behavior.sql" >"$fixture"
cat "$repo_root/supabase/tests/reviewed_claimed_tranche_full_path.sql" >>"$fixture"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <"$fixture"
if [[ -n "$guard_before" ]]; then
  {
    printf 'set check_function_bodies = off;\n'
    cat "$repo_root/supabase/migrations/rollback/20261110130000_reviewed_claimed_payout_retry.rollback.sql"
  } | docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
  guard_after=$(docker exec "$container" psql -U postgres -At -c \
    "select md5(pg_get_functiondef('public.guard_claimed_replacement_against_refund()'::regprocedure))")
  if [[ "$guard_before" != "$guard_after" ]]; then
    echo 'Rollback changed the earlier reviewed correction guard' >&2
    exit 1
  fi
  echo 'PASS rollback preserved the earlier reviewed correction guard'
fi
