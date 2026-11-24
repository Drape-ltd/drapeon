#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-tailor-claim-email-$$"
logs="$(mktemp -d)"
stage="starting Postgres container"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$logs"; }
report_failure() {
  local status=$?
  printf 'Fresh claim-email Postgres proof failed during %s at line %s (exit %s).\n' \
    "$stage" "${BASH_LINENO[0]:-unknown}" "$status" >&2
  if [[ "$stage" == "waiting for Postgres readiness" ]]; then
    docker logs "$container" >&2 || true
  fi
  exit "$status"
}
trap report_failure ERR
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
stage="waiting for Postgres readiness"
 # The image's temporary initdb server accepts only Unix sockets. Require TCP so
 # this cannot report ready before the real Postgres listener has started.
 ready=false
 for _ in {1..60}; do
   if docker exec "$container" pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres -t 1 >/dev/null 2>&1; then
     ready=true
     break
   fi
   sleep 1
 done
 if [[ "$ready" != true ]]; then
   docker exec "$container" pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres -t 1 >/dev/null
 fi

stage="loading the isolated schema"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tailor_claim_email_isolated_schema.sql" >"$logs/schema.log"

stage="applying claim-email migrations"
for migration in \
  20261117212042_add_tailor_claim_email_codes.sql \
  20261117212332_fix_tailor_claim_email_issue_ambiguity.sql \
  20261117212502_fix_tailor_claim_email_verify_ambiguity.sql \
  20261117212930_add_tailor_claim_email_collision_guard.sql \
  20261117213656_harden_tailor_claim_email_verification.sql \
  20261117225500_add_tailor_claim_bootstrap_sessions.sql \
  20261118015235_harden_tailor_claim_request_boundary.sql \
  20261118021045_add_tailor_claim_provider_bootstrap.sql \
  20261118023943_verify_tailor_claim_provider_before_bootstrap.sql \
  20261118034153_allow_tailor_claim_provider_retry.sql \
  20261122013431_harden_tailor_claim_provider_cleanup_and_anon_pre_request.sql \
  20261123165353_add_staff_draft_deny_policies_for_payment_tables.sql \
  20261124034830_wrap_staff_draft_rls_identity_check.sql
do
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
    <"$repo_root/supabase/migrations/$migration" >>"$logs/migrations.log"
done

stage="checking claim-email behavior"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tailor_claim_email_behavior.sql" >"$logs/behavior.log"
grep -q 'tailor_claim_email_fresh_postgres_passed' "$logs/behavior.log"
stage="checking bootstrap behavior"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tailor_claim_bootstrap_behavior.sql" >"$logs/bootstrap.log"
grep -q 'tailor_claim_bootstrap_fresh_postgres_passed' "$logs/bootstrap.log"
stage="checking request-boundary behavior"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tailor_claim_request_boundary_behavior.sql" >"$logs/request-boundary.log"
grep -q 'tailor_claim_request_boundary_fresh_postgres_passed' "$logs/request-boundary.log"
stage="checking RLS policy coverage"
node "$repo_root/scripts/check-staff-draft-rls-policy.mjs"
echo 'GREEN: claim-email migrations, bootstrap hardening, and the payment RLS deny-policy repair pass on fresh Postgres.'

