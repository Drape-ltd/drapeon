#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-tailor-claim-email-consumed-$$"
stage="starting Postgres container"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
report_failure() {
  local status=$?
  printf 'Fresh Postgres proof failed during %s at line %s (exit %s).\n' \
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
for _ in {1..40}; do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null

stage="creating the original email-code constraint"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create table public.tailor_claim_email_codes (
  id integer primary key,
  status text not null check (status in ('PENDING', 'VERIFIED', 'CONSUMED', 'EXPIRED')),
  verified_at timestamptz,
  constraint tailor_claim_email_codes_check1
    check ((status = 'VERIFIED') = (verified_at is not null))
);
insert into public.tailor_claim_email_codes values (1, 'VERIFIED', now());
do $$
begin
  begin
    update public.tailor_claim_email_codes set status = 'CONSUMED' where id = 1;
    raise exception 'Original constraint unexpectedly allowed CONSUMED';
  exception when check_violation then
    null;
  end;
end;
$$;
SQL

stage="checking the expected original constraint definition"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/tests/tailor_claim_email_consumed_preflight.sql" \
  >/dev/null

stage="applying the consumed-code migration"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 \
  <"$repo_root/supabase/migrations/20261119044734_allow_consumed_tailor_claim_email_code.sql" \
  >/dev/null

stage="verifying consumed-code behavior"
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
update public.tailor_claim_email_codes set status = 'CONSUMED' where id = 1;
do $$
begin
  if not exists (
    select 1 from public.tailor_claim_email_codes
    where id = 1 and status = 'CONSUMED' and verified_at is not null
  ) then
    raise exception 'Verified timestamp was not preserved after consumption';
  end if;
  begin
    insert into public.tailor_claim_email_codes values (2, 'CONSUMED', null);
    raise exception 'CONSUMED without verification unexpectedly passed';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.tailor_claim_email_codes values (3, 'PENDING', now());
    raise exception 'PENDING with verification unexpectedly passed';
  exception when check_violation then
    null;
  end;
end;
$$;
select 'tailor_claim_email_consumed_fresh_postgres_passed' as result;
SQL
