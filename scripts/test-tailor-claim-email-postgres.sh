#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-tailor-claim-email-$$"
logs="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$logs"; }
trap cleanup EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tailor_claim_email_isolated_schema.sql" >"$logs/schema.log"

for migration in \
  20261117212042_add_tailor_claim_email_codes.sql \
  20261117212332_fix_tailor_claim_email_issue_ambiguity.sql \
  20261117212502_fix_tailor_claim_email_verify_ambiguity.sql \
  20261117212930_add_tailor_claim_email_collision_guard.sql \
  20261117213656_harden_tailor_claim_email_verification.sql \
  20261117225500_add_tailor_claim_bootstrap_sessions.sql \
  20261118015235_harden_tailor_claim_request_boundary.sql \
  20261118021045_add_tailor_claim_provider_bootstrap.sql \
  20261118023943_verify_tailor_claim_provider_before_bootstrap.sql
do
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
    <"$repo_root/supabase/migrations/$migration" >>"$logs/migrations.log"
done

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tailor_claim_email_behavior.sql" >"$logs/behavior.log"
grep -q 'tailor_claim_email_fresh_postgres_passed' "$logs/behavior.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tailor_claim_bootstrap_behavior.sql" >"$logs/bootstrap.log"
grep -q 'tailor_claim_bootstrap_fresh_postgres_passed' "$logs/bootstrap.log"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tailor_claim_request_boundary_behavior.sql" >"$logs/request-boundary.log"
grep -q 'tailor_claim_request_boundary_fresh_postgres_passed' "$logs/request-boundary.log"
node "$repo_root/scripts/check-staff-draft-rls-policy.mjs"
echo 'GREEN: the five claim-email migrations plus all four second-stage migrations pass on fresh Postgres.'

