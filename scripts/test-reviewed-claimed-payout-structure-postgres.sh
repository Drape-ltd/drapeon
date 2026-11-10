#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-reviewed-retry-structure-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create role anon;
create role authenticated;
create role service_role;
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/reviewed_claimed_payout_retry_isolated_schema.sql" >/dev/null
awk '/^create or replace function public.prevent_payout_provider_operation_identity_change\(\)/{copy=1} copy{print} copy && /^\$\$;/{exit}' \
  "$repo_root/supabase/migrations/20261102204053_bind_claimed_stripe_source_charge.sql" |
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create trigger payout_provider_operation_identity_immutable
before update on public.payout_provider_operations
for each row execute function public.prevent_payout_provider_operation_identity_change();
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create table public.money_desk_requests(
  id uuid primary key,action_type text,target_type text,target_id text,
  order_id text,amount integer,currency public.currency,status text,
  approved_at timestamptz,required_approval_count integer,approval_count integer,
  requester_subject text,requester_email text,
  action_payload jsonb not null default '{}'::jsonb
);
create table public.money_desk_decisions(
  request_id uuid,decision text,approver_subject text,approver_email text
);
create table public.payout_destination_corrections(
  id uuid primary key,claim_id uuid,failed_payout_id uuid,
  money_desk_request_id uuid,order_id text,tailor_profile_id text,
  provider text,operation_number integer,
  previous_destination_fingerprint text,replacement_destination_fingerprint text
);
create table public.money_desk_execution_attempts(
  id uuid primary key default gen_random_uuid(),request_id uuid,status text,
  executor_email text,executor_role text
);
create table public.money_desk_events(
  request_id uuid,event_type text,actor_email text,actor_role text,
  payload jsonb,correlation_id uuid
);
alter table public.money_desk_requests
  add column correlation_id uuid;
alter table public.payout_provider_operations
  add constraint payout_provider_operations_check check (
    (operation_number=1 and reviewed_correction_id is null and money_desk_request_id is null)
    or (operation_number>1 and reviewed_correction_id is not null and money_desk_request_id is not null)
  );
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/migrations/20261110095223_reviewed_claimed_payout_retry.sql" >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create trigger require_matching_reviewed_payout_operation
before insert on public.payout_provider_operations
for each row execute function public.require_matching_payout_correction_operation();
create trigger validate_reviewed_payout_operation_reservation
before insert on public.payout_provider_operations
for each row execute function public.validate_payout_provider_operation_reservation();
create trigger verify_reviewed_payout_operation_destination
before insert on public.payout_provider_operations
for each row execute function public.verify_provider_operation_destination_fingerprints();
create trigger payout_attempt_replacement_identity_guard
before insert or update on public.payout_attempts
for each row execute function public.verify_replacement_attempt_identity();
create trigger payout_operation_prepare_replacement_attempt
after update of status on public.payout_provider_operations
for each row execute function public.prepare_replacement_attempt_on_start();
SQL
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/reviewed_claimed_payout_retry_structure.sql"
{
  printf 'set check_function_bodies = off;\n'
  cat "$repo_root/supabase/migrations/rollback/20261110095223_reviewed_claimed_payout_retry.rollback.sql"
} | docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
do $test$
begin
  if to_regclass('public.payout_claim_retry_authorizations') is not null
    or exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='payout_provider_operations'
        and column_name='reviewed_retry_id')
    or not exists (select 1 from pg_constraint
      where conrelid='public.payout_provider_operations'::regclass
        and conname='payout_provider_operations_check'
        and pg_get_constraintdef(oid) like '%reviewed_correction_id IS NOT NULL%'
        and pg_get_constraintdef(oid) not like '%reviewed_retry_id%') then
    raise exception 'Rollback did not restore the old operation identity rule';
  end if;
  raise notice 'PASS rollback restored old operation identity rule';
end;
$test$;
SQL
