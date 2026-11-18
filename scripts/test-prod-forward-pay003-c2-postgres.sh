#!/usr/bin/env bash
# Disposable PostgreSQL 17 proof for the forward PAY-003 and C2 migrations.
# Both ID shapes, pre-migration RED, transaction rollback, GREEN and replay.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-forward-pay-c2-$$"
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

psql_db() {
  local database="$1"
  docker exec -i "$container" psql -X -U postgres -d "$database" -v ON_ERROR_STOP=1 "${@:2}"
}
run_sql() {
  local database="$1" label="$2"
  if ! psql_db "$database" >"$logs/$label.log" 2>&1; then
    tail -n 45 "$logs/$label.log" >&2
    return 1
  fi
}
assert_count() {
  local database="$1" expected="$2" query="$3" label="$4" actual
  actual="$(printf '%s\n' "$query" | psql_db "$database" -At)"
  if [[ "$actual" != "$expected" ]]; then
    echo "$label: expected $expected, got $actual" >&2
    return 1
  fi
}
expect_error() {
  local database="$1" label="$2" expected="$3"
  if psql_db "$database" >"$logs/$label.log" 2>&1; then
    echo "$label unexpectedly passed" >&2
    return 1
  fi
  if ! rg -Fq "$expected" "$logs/$label.log"; then
    echo "$label failed for the wrong reason" >&2
    tail -n 35 "$logs/$label.log" >&2
    return 1
  fi
}

pay_schema="$repo_root/supabase/migrations/20261118222734_prod_forward_pay003_schema.sql"
pay_runtime="$repo_root/supabase/migrations/20261118223008_prod_forward_pay003_runtime.sql"
pay_baseline="$repo_root/supabase/migrations/20261118223016_prod_forward_pay003_refund_baseline.sql"
pay_hardening="$repo_root/supabase/migrations/20261118223018_prod_forward_pay003_hardening.sql"
c2_guard="$repo_root/supabase/migrations/20261118223234_prod_forward_c2_payout_guard.sql"
c2_baseline="$repo_root/supabase/migrations/20261118223236_prod_forward_c2_destination_baseline.sql"
c2_returned="$repo_root/supabase/migrations/20261118223241_prod_forward_c2_returned_funds_guard.sql"

for shape in uuid text; do
  pay_db="pay_${shape}"
  c2_db="c2_${shape}"
  docker exec "$container" createdb -U postgres "$pay_db"
  docker exec "$container" createdb -U postgres "$c2_db"

  if [[ "$shape" == uuid ]]; then
    cat "$repo_root/supabase/tests/fixtures/pay003_batch1_migration_rehearsal.sql" | run_sql "$pay_db" "pay-fixture-$shape"
    sed -e '/^create role /d' -e '/create table public.payouts (/{n;s/id uuid primary key,/id uuid primary key,\n  order_id uuid,/;}' \
      "$repo_root/supabase/tests/fixtures/pay003_c2_recovery_rehearsal.sql" | run_sql "$c2_db" "c2-fixture-$shape"
  else
    sed -e '/^create role /d' \
      -e '/create table public.orders (/{n;s/id uuid primary key,/id text primary key,/;}' \
      -e 's/order_id uuid not null references public.orders(id)/order_id text not null references public.orders(id)/' \
      -e 's/^  order_id uuid,$/  order_id text,/' \
      "$repo_root/supabase/tests/fixtures/pay003_batch1_migration_rehearsal.sql" | run_sql "$pay_db" "pay-fixture-$shape"
    sed -e '/^create role /d' \
      -e '/create table public.payouts (/{n;s/id uuid primary key,/id text primary key,\n  order_id text,/;}' \
      -e '/create table public.orders (/{n;s/id uuid primary key,/id text primary key,/;}' \
      "$repo_root/supabase/tests/fixtures/pay003_c2_recovery_rehearsal.sql" | run_sql "$c2_db" "c2-fixture-$shape"
  fi
  printf 'create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key);\n' | run_sql "$pay_db" "pay-history-$shape"
  printf 'alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated;\n' | run_sql "$pay_db" "pay-default-grants-$shape"
  printf 'create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key); create function private.sync_returned_snapshot_tranche_payout() returns trigger language plpgsql as $$ begin return new; end; $$; create trigger payout_claim_sync_returned_snapshot_tranche after update on public.payout_claims for each row execute function private.sync_returned_snapshot_tranche_payout();\n' | run_sql "$c2_db" "c2-history-$shape"

  assert_count "$pay_db" 0 "select count(*) from pg_class where relname in ('payment_status_transition_audits','order_payment_provider_refunds','payment_late_success_refund_operations');" "PAY-003 RED $shape"
  assert_count "$c2_db" 0 "select count(*) from pg_trigger where tgname='payout_forward_status_guard' and not tgisinternal;" "C2 RED $shape"
  {
    printf 'begin;\n'
    cat "$pay_schema" "$pay_runtime" "$pay_baseline"
  } | expect_error "$pay_db" "pay-data-red-$shape" 'PAY003_BASELINE_REQUIRES_ROW_REVIEW:1'
  {
    printf 'begin;\n'
    cat "$c2_guard" "$c2_baseline"
  } | expect_error "$c2_db" "c2-data-red-$shape" 'C2_DESTINATION_REQUIRES_ROW_REVIEW:1'

  for ending in rollback commit replay; do
    {
      printf 'begin;\n'
      cat "$pay_schema" "$pay_runtime"
      printf "insert into public.order_payment_provider_refunds(payment_id,provider,provider_refund_id,amount,status) values ('73000000-0000-4000-8000-000000000002','STRIPE','synthetic-preexisting-refund',250,'CONFIRMED') on conflict (provider,provider_refund_id) do nothing;\n"
      cat "$pay_baseline" "$pay_hardening"
      if [[ "$ending" == rollback ]]; then printf 'rollback;\n'; else printf 'commit;\n'; fi
    } | run_sql "$pay_db" "pay-$shape-$ending"

    {
      printf 'begin;\n'
      printf "update public.payouts set provider_destination_id='acct-restored' where id::text='83000000-0000-4000-8000-000000000001' and provider_destination_id is null;\n"
      cat "$c2_guard" "$c2_baseline" "$c2_returned"
      if [[ "$ending" == rollback ]]; then printf 'rollback;\n'; else printf 'commit;\n'; fi
    } | run_sql "$c2_db" "c2-$shape-$ending"

    if [[ "$ending" == rollback ]]; then
      assert_count "$pay_db" 0 "select count(*) from pg_class where relname in ('payment_status_transition_audits','order_payment_provider_refunds','payment_late_success_refund_operations');" "PAY-003 rollback $shape"
      assert_count "$c2_db" 0 "select count(*) from pg_trigger where tgname='payout_forward_status_guard' and not tgisinternal;" "C2 rollback $shape"
    else
      assert_count "$pay_db" 3 "select count(*) from pg_class where relname in ('payment_status_transition_audits','order_payment_provider_refunds','payment_late_success_refund_operations') and relkind='r';" "PAY-003 GREEN $shape"
      assert_count "$pay_db" 2 "select count(*) from pg_trigger where tgname in ('order_payment_forward_status_guard','order_payment_backed_advancement_guard') and not tgisinternal;" "PAY-003 guards $shape"
      assert_count "$pay_db" 0 "select count(*) from pg_class c where c.relname in ('payment_status_transition_audits','order_payment_provider_refunds','payment_late_success_refund_operations') and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'select') or has_table_privilege('authenticated',c.oid,'select'));" "PAY-003 client deny $shape"
      assert_count "$c2_db" 2 "select count(*) from pg_trigger where tgname in ('payout_forward_status_guard','payout_claim_sync_returned_snapshot_tranche') and not tgisinternal;" "C2 guards $shape"
    fi
  done
  echo "GREEN: $shape PAY-003/C2 forward install, rollback, replay and ACL/trigger checks"
done
