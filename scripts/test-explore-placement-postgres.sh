#!/usr/bin/env bash
# Real-Postgres proof for both live tailor_profiles.id shapes: RED on the
# baseline, RED for Ops moves before 154000 on uuid, GREEN, replay and rollback.
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
  'create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;' >"$logs/roles.log"
run_sql() {
  local database="$1"
  shift
  docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 "$@"
}

run_case() {
  local ID_TYPE="$1"
  local database="placement_${ID_TYPE}"
  local case_logs="$logs/$ID_TYPE"
  mkdir -p "$case_logs"
  echo "=== Explore placement proof: tailor_profiles.id $ID_TYPE ==="

  docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "create database $database" >"$case_logs/db.log"
  run_sql "$database" -v ID_TYPE="$ID_TYPE" \
    <"$repo_root/supabase/tests/explore_placement_isolated_schema.sql" >"$case_logs/schema.log"

  # Match Production's public-schema defaults before applying A1: new tables
  # grant all table privileges and new functions grant EXECUTE to client roles.
  run_sql "$database" -c \
    'alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant execute on functions to anon, authenticated;' \
    >"$case_logs/default-privileges.log"

  # Apply A1 itself: the decision FK column must inherit the exact profile ID type.
  run_sql "$database" <"$m/20261110050000_marketplace_category.sql" >"$case_logs/a1.log"
  local profile_type decision_type fk_definition
  profile_type="$(run_sql "$database" -At -c "select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.tailor_profiles'::regclass and a.attname = 'id' and a.attnum > 0 and not a.attisdropped")"
  decision_type="$(run_sql "$database" -At -c "select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.marketplace_category_decisions'::regclass and a.attname = 'tailor_profile_id' and a.attnum > 0 and not a.attisdropped")"
  fk_definition="$(run_sql "$database" -At -c "select pg_get_constraintdef(c.oid) from pg_constraint c join pg_attribute fa on fa.attrelid = c.conrelid and fa.attnum = any(c.conkey) join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = any(c.confkey) where c.contype = 'f' and c.conrelid = 'public.marketplace_category_decisions'::regclass and c.confrelid = 'public.tailor_profiles'::regclass and fa.attname = 'tailor_profile_id' and ra.attname = 'id'")"
  if [[ "$profile_type" != "$ID_TYPE" || "$decision_type" != "$ID_TYPE" ]]; then
    echo "A1 type mismatch: profile=$profile_type decision=$decision_type expected=$ID_TYPE" >&2
    exit 1
  fi
  if [[ "$fk_definition" != "FOREIGN KEY (tailor_profile_id) REFERENCES tailor_profiles(id) ON DELETE CASCADE" ]]; then
    echo "A1 FK definition differs: $fk_definition" >&2
    exit 1
  fi
  echo "PASS: A1 creates $decision_type decision IDs with the exact profile FK."

  # RED: A1 alone inherits Production's public-schema default grants.
  run_sql "$database" <<'SQL' >"$case_logs/a1-acl-red.log"
do $$
begin
  if not has_table_privilege('anon', 'public.marketplace_category_decisions', 'select')
    or not has_table_privilege('authenticated', 'public.marketplace_category_decisions', 'select')
    or not has_function_privilege('anon', 'public.guard_tailor_marketplace_category()', 'execute')
    or not has_function_privilege('authenticated', 'public.guard_tailor_marketplace_category()', 'execute') then
    raise exception 'Expected A1 to inherit Production default client grants before A1b.';
  end if;
end;
$$;
SQL
  echo 'RED: A1 inherits Production default SELECT and guard EXECUTE grants for anon/authenticated.'

  local acl_contract="$repo_root/supabase/tests/marketplace_decisions_acl_contract.sql"
  run_sql "$database" -v EXPECT_CLIENT_GRANTS=true -v EXPECT_A1B_INDEX=false \
    <"$acl_contract" >"$case_logs/a1b-acl-red.log" 2>&1 \
    || { tail -30 "$case_logs/a1b-acl-red.log" >&2; exit 1; }
  echo 'PASS: A1b RED fixture confirms both client roles inherit default table/function privileges.'

  run_sql "$database" <"$m/20261111170000_marketplace_decisions_acl_hardening.sql" >"$case_logs/a1b.log"
  run_sql "$database" -v EXPECT_CLIENT_GRANTS=false -v EXPECT_A1B_INDEX=true \
    <"$acl_contract" >"$case_logs/a1b-green.log" 2>&1 \
    || { tail -30 "$case_logs/a1b-green.log" >&2; exit 1; }
  run_sql "$database" -c \
    "insert into public.tailor_profiles (id, user_id, supports_custom_orders) values ('10000000-0000-0000-0000-0000000000ee', '00000000-0000-0000-0000-0000000000ee', true)" >/dev/null
  run_sql "$database" -c \
    "begin; set local role service_role; select count(*) from public.marketplace_category_decisions; insert into public.marketplace_category_decisions (tailor_profile_id, from_category, to_category, reason, actor, idempotency_key) values ('10000000-0000-0000-0000-0000000000ee', 'TAILORING', 'STREETWEAR', 'service role ACL proof', 'qa', 'service-role-a1b-proof'); rollback" \
    >"$case_logs/service-role-acl.log"
  grep -Fq 'INSERT 0 1' "$case_logs/service-role-acl.log" \
    || { echo 'service_role could not read and insert decision history after A1b.' >&2; cat "$case_logs/service-role-acl.log" >&2; exit 1; }
  echo "GREEN: A1b denies client table/function access and service_role can read/insert for $ID_TYPE IDs."

  # Replay is safe and keeps the same locked-down ACL, index, and deny-all RLS contract.
  run_sql "$database" <"$m/20261111170000_marketplace_decisions_acl_hardening.sql" >"$case_logs/a1b-replay.log"
  run_sql "$database" -v EXPECT_CLIENT_GRANTS=false -v EXPECT_A1B_INDEX=true \
    <"$acl_contract" >"$case_logs/a1b-replay-contract.log" 2>&1 \
    || { tail -30 "$case_logs/a1b-replay-contract.log" >&2; exit 1; }
  echo 'REPLAY: A1b reapplies without restoring client grants or changing its index contract.'

  run_sql "$database" <"$m/rollback/20261111170000_marketplace_decisions_acl_hardening.rollback.sql" >"$case_logs/a1b-rollback.log"
  run_sql "$database" -v EXPECT_CLIENT_GRANTS=false -v EXPECT_A1B_INDEX=false \
    <"$acl_contract" >"$case_logs/a1b-rollback-contract.log" 2>&1 \
    || { tail -30 "$case_logs/a1b-rollback-contract.log" >&2; exit 1; }
  if run_sql "$database" -At -c \
    "select has_table_privilege('service_role', 'public.marketplace_category_decisions', 'insert')" | grep -qx t; then
    echo 'A1b rollback did not restore A1 service_role table grants.' >&2; exit 1
  fi
  run_sql "$database" <"$m/20261111170000_marketplace_decisions_acl_hardening.sql" >"$case_logs/a1b-after-rollback-replay.log"
  run_sql "$database" -v EXPECT_CLIENT_GRANTS=false -v EXPECT_A1B_INDEX=true \
    <"$acl_contract" >"$case_logs/a1b-after-rollback-contract.log" 2>&1 \
    || { tail -30 "$case_logs/a1b-after-rollback-contract.log" >&2; exit 1; }
  echo 'ROLLBACK: restores A1 service_role table grants and no index; client grants stay revoked, then A1b reapplies cleanly.'

  # Baseline = the exact pre-placement definitions captured in rollback files.
  run_sql "$database" <"$rb/20261111151000_marketplace_placement_eligibility.rollback.sql" >"$case_logs/base-guard.log"
  run_sql "$database" <"$rb/20261111152000_trust_approval_requires_placement.rollback.sql" >"$case_logs/base-approve.log"

  local behavior="$repo_root/supabase/tests/explore_placement_behavior.sql"
  if run_sql "$database" <"$behavior" >"$case_logs/red.log" 2>&1; then
    echo 'Expected the live baseline to fail the placement behaviour.' >&2; exit 1
  fi
  grep -q 'FAIL: approve without placement succeeded\|PLACEMENT' "$case_logs/red.log" || { tail -20 "$case_logs/red.log" >&2; exit 1; }
  echo 'RED: the live baseline approves without a placement.'

  # A legacy row keeps its data through the enum rename.
  run_sql "$database" -c "insert into public.tailor_profiles (id, user_id, marketplace_category, supports_custom_orders) values ('10000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-0000000000ff', 'STREETWEAR', false);" >/dev/null
  run_sql "$database" <"$m/20261111150000_rename_marketplace_ready_to_wear.sql" >"$case_logs/m1.log"
  run_sql "$database" <"$m/20261111151000_marketplace_placement_eligibility.sql" >"$case_logs/m2.log"
  run_sql "$database" <"$m/20261111152000_trust_approval_requires_placement.sql" >"$case_logs/m3.log"
  [ "$(run_sql "$database" -At -c "select marketplace_category from public.tailor_profiles where id::text = '10000000-0000-0000-0000-0000000000ff'")" = "READY_TO_WEAR" ] \
    || { echo 'Legacy STREETWEAR row was not preserved as READY_TO_WEAR' >&2; exit 1; }
  run_sql "$database" -c "delete from public.tailor_profiles where id::text = '10000000-0000-0000-0000-0000000000ff'" >/dev/null

  # The old trigger list misses custom-order changes until 153000.
  local trigger_probe="begin; insert into public.tailor_profiles (id, user_id, display_name, supports_custom_orders, is_verified, is_live, id_verification_status) values ('10000000-0000-0000-0000-0000000000fd', '00000000-0000-0000-0000-0000000000fd', 'Trigger probe', true, true, true, 'VERIFIED'); set local role authenticated; update public.tailor_profiles set supports_custom_orders = false where id::text = '10000000-0000-0000-0000-0000000000fd'; rollback;"
  run_sql "$database" -c "$trigger_probe" >"$case_logs/red-trigger.log" 2>&1 \
    || { echo 'Expected the old trigger list to miss a custom-orders change.' >&2; tail -20 "$case_logs/red-trigger.log" >&2; exit 1; }
  echo 'RED: the old trigger does not fire when custom orders are turned off.'
  run_sql "$database" <"$m/20261111153000_placement_guard_trigger_columns.sql" >"$case_logs/m4.log"
  if run_sql "$database" -c "$trigger_probe" >"$case_logs/green-trigger.log" 2>&1; then
    echo 'Expected 153000 to block custom-orders changes for verified Tailors sellers.' >&2; exit 1
  fi
  grep -Fq 'PLACEMENT_REQUIRES_CUSTOM_ORDERS' "$case_logs/green-trigger.log" \
    || { echo '153000 failed for a reason other than the placement guard.' >&2; tail -20 "$case_logs/green-trigger.log" >&2; exit 1; }
  echo 'GREEN: 153000 blocks custom-orders changes for verified Tailors sellers.'

  # A2's function body still compares uuid to text; prove that failure before
  # the forward compatibility migration, while keeping the text path green.
  local id_probe="begin; insert into public.tailor_profiles (id, user_id, supports_custom_orders) values ('10000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000fc', true); select public.ops_set_marketplace_category('10000000-0000-0000-0000-0000000000fc', 'READY_TO_WEAR', 'Compatibility probe reason', 'qa-ops', 'before-154000-probe'); rollback;"
  if [[ "$ID_TYPE" == "uuid" ]]; then
    if run_sql "$database" -c "$id_probe" >"$case_logs/red-id-type.log" 2>&1; then
      echo 'Expected uuid profile IDs to fail before 154000.' >&2; exit 1
    fi
    grep -Fq 'operator does not exist: uuid = text' "$case_logs/red-id-type.log" \
      || { echo 'UUID pre-154000 failure did not show the expected uuid/text comparison.' >&2; tail -20 "$case_logs/red-id-type.log" >&2; exit 1; }
    echo 'RED: Ops category move hits the uuid/text comparison before 154000.'
  else
    run_sql "$database" -c "$id_probe" >"$case_logs/text-id-before-154000.log"
    echo 'PASS: the existing text-ID Dev path remains usable before 154000.'
  fi

  local approval_probe="begin; insert into public.tailor_profiles (id, user_id, display_name, supports_custom_orders) values ('10000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000fb', 'Approval probe', true); select * from public.ops_decide_verification('00000000-0000-0000-0000-0000000000fb', 'APPROVE', 'Approval compatibility probe', null, 'READY_TO_WEAR', 'qa-ops'); rollback;"
  if [[ "$ID_TYPE" == "uuid" ]]; then
    if run_sql "$database" -c "$approval_probe" >"$case_logs/red-approval-id-type.log" 2>&1; then
      echo 'Expected trust approval to fail before 154000 on uuid profile IDs.' >&2; exit 1
    fi
    grep -Fq 'column "tailor_profile_id" is of type uuid but expression is of type text' "$case_logs/red-approval-id-type.log" \
      || { echo 'Trust approval failed for an unexpected reason before 154000.' >&2; tail -20 "$case_logs/red-approval-id-type.log" >&2; exit 1; }
    echo 'RED: trust approval writes a text ID into the uuid decision FK before 154000.'
  else
    run_sql "$database" -c "$approval_probe" >"$case_logs/text-approval-before-154000.log"
    echo 'PASS: the existing text-ID trust approval path remains usable before 154000.'
  fi

  run_sql "$database" -At -c "select pg_get_functiondef('public.ops_set_marketplace_category(text, public.marketplace_category, text, text, text)'::regprocedure)" \
    >"$case_logs/ops-set-before-154000.sql"
  run_sql "$database" -At -c "select pg_get_functiondef('public.ops_decide_verification(uuid, text, text, text, text, text)'::regprocedure)" \
    >"$case_logs/approval-before-154000.sql"
  run_sql "$database" <"$m/20261111154000_marketplace_placement_id_type_compat.sql" >"$case_logs/m5.log"
  run_sql "$database" -v EXPECT_CLIENT_GRANTS=false -v EXPECT_A1B_INDEX=true \
    <"$acl_contract" >"$case_logs/a1b-after-a2-contract.log" 2>&1 \
    || { tail -30 "$case_logs/a1b-after-a2-contract.log" >&2; exit 1; }
  echo "PASS: later A2 create-or-replace function definitions preserve A1b ACLs for $ID_TYPE IDs."
  run_sql "$database" <"$repo_root/supabase/tests/explore_placement_ops_id_type.sql" >"$case_logs/id-type.log" 2>&1 \
    || { tail -30 "$case_logs/id-type.log" >&2; exit 1; }
  run_sql "$database" <"$behavior" >"$case_logs/green.log" 2>&1 || { tail -30 "$case_logs/green.log" >&2; exit 1; }
  grep -E 'NOTICE: +PASS:' "$case_logs/green.log"
  echo "GREEN: category move, decision history, idempotent replay and rollback behavior work for $ID_TYPE."

  # Reapplying the function migrations, including 154000, preserves behavior.
  run_sql "$database" <"$m/20261111151000_marketplace_placement_eligibility.sql" >/dev/null
  run_sql "$database" <"$m/20261111152000_trust_approval_requires_placement.sql" >/dev/null
  run_sql "$database" <"$m/20261111153000_placement_guard_trigger_columns.sql" >/dev/null
  run_sql "$database" <"$m/20261111154000_marketplace_placement_id_type_compat.sql" >/dev/null
  run_sql "$database" <"$repo_root/supabase/tests/explore_placement_ops_id_type.sql" >"$case_logs/id-type-replay.log" 2>&1 \
    || { tail -30 "$case_logs/id-type-replay.log" >&2; exit 1; }
  run_sql "$database" <"$behavior" >"$case_logs/replay.log" 2>&1 || { tail -30 "$case_logs/replay.log" >&2; exit 1; }
  echo 'REPLAY: reapplying 151000–154000 keeps the same behavior.'

  run_sql "$database" <"$rb/20261111154000_marketplace_placement_id_type_compat.rollback.sql" >"$case_logs/r5.log"
  run_sql "$database" -At -c "select pg_get_functiondef('public.ops_set_marketplace_category(text, public.marketplace_category, text, text, text)'::regprocedure)" \
    >"$case_logs/ops-set-after-154000-rollback.sql"
  diff -u "$case_logs/ops-set-before-154000.sql" "$case_logs/ops-set-after-154000-rollback.sql"
  run_sql "$database" -At -c "select pg_get_functiondef('public.ops_decide_verification(uuid, text, text, text, text, text)'::regprocedure)" \
    >"$case_logs/approval-after-154000-rollback.sql"
  diff -u "$case_logs/approval-before-154000.sql" "$case_logs/approval-after-154000-rollback.sql"
  run_sql "$database" <"$rb/20261111153000_placement_guard_trigger_columns.rollback.sql" >"$case_logs/r4.log"
  [ "$(run_sql "$database" -At -c "select pg_get_triggerdef(oid) from pg_trigger where tgname = 'trg_guard_tailor_marketplace_category'")" = "CREATE TRIGGER trg_guard_tailor_marketplace_category BEFORE INSERT OR UPDATE OF marketplace_category ON public.tailor_profiles FOR EACH ROW EXECUTE FUNCTION guard_tailor_marketplace_category()" ] \
    || { echo 'Trigger rollback did not restore the original column list' >&2; exit 1; }
  run_sql "$database" <"$rb/20261111152000_trust_approval_requires_placement.rollback.sql" >"$case_logs/r3.log"
  run_sql "$database" <"$rb/20261111151000_marketplace_placement_eligibility.rollback.sql" >"$case_logs/r2.log"
  run_sql "$database" <"$rb/20261111150000_rename_marketplace_ready_to_wear.rollback.sql" >"$case_logs/r1.log"
  labels="$(run_sql "$database" -At -c "select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'marketplace_category'")"
  [ "$labels" = "TAILORING,STREETWEAR" ] || { echo "Rollback enum labels: $labels" >&2; exit 1; }
  run_sql "$database" -At -c "insert into public.tailor_profiles (id, user_id) values ('10000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000aa'); select status from public.ops_decide_verification('00000000-0000-0000-0000-0000000000aa', 'APPROVE');" | grep -q VERIFIED \
    || { echo 'Rollback did not restore the four-argument approval' >&2; exit 1; }
  echo 'ROLLBACK: 154000 restores the 151000 function; placement migrations restore their baseline.'
}

for ID_TYPE in text uuid; do
  run_case "$ID_TYPE"
done
