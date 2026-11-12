#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="drape-money-notice-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT

docker run --name "$container" -e POSTGRES_PASSWORD=localtestonly -d postgres:17-alpine >/dev/null
ready=false
for _ in $(seq 1 40); do
  # The entrypoint's temporary server accepts local sockets before the final
  # server restarts. Probe SQL over TCP so the fixture never races that restart.
  if docker exec "$container" env PGPASSWORD=localtestonly \
    psql -h 127.0.0.1 -U postgres -d postgres -Atqc 'select 1' 2>/dev/null | grep -qx '1'; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'Postgres did not accept a TCP SQL connection within 40 seconds.' >&2
  docker logs "$container" >&2 || true
  exit 1
fi
run_sql() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q; }
run_migration() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -q; }

# The original check is copied from the table definition. Test against a real
# Postgres constraint, including the three values written by the running apps.
cat <<'SQL' | run_sql
create table public.money_desk_events (
  event_type text not null check (event_type in (
    'REQUEST_SUBMITTED', 'APPROVAL_RECORDED', 'REQUEST_APPROVED', 'REQUEST_REJECTED',
    'EXECUTION_STARTED', 'EXECUTION_SUCCEEDED', 'EXECUTION_FAILED', 'EXECUTION_BLOCKED',
    'REQUEST_CANCELLED'
  ))
);
do $$
begin
  begin
    insert into public.money_desk_events values ('FOUNDER_APPROVAL_EMAIL_FAILED');
    raise exception 'main unexpectedly accepted email outcome';
  exception when check_violation then null;
  end;
end $$;
SQL

run_migration <"$repo_root/supabase/migrations/20261112001443_money_desk_approval_notice_events.sql"
cat <<'SQL' | run_sql
insert into public.money_desk_events values
  ('REQUEST_SUBMITTED'),
  ('FOUNDER_APPROVAL_EMAIL_SENT'),
  ('FOUNDER_APPROVAL_EMAIL_SKIPPED'),
  ('FOUNDER_APPROVAL_EMAIL_FAILED');
do $$
begin
  begin
    insert into public.money_desk_events values ('UNREVIEWED_EVENT');
    raise exception 'unknown event unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
SQL

# The rollback must not destroy append-only outcome rows. It fails closed
# until those rows are absent in this disposable fixture.
if run_migration <"$repo_root/supabase/migrations/rollback/20261112001443_money_desk_approval_notice_events.rollback.sql" >/dev/null 2>&1; then
  echo 'rollback unexpectedly accepted existing email outcomes' >&2
  exit 1
fi
echo "delete from public.money_desk_events where event_type like 'FOUNDER_APPROVAL_EMAIL_%';" | run_sql
run_migration <"$repo_root/supabase/migrations/rollback/20261112001443_money_desk_approval_notice_events.rollback.sql"
cat <<'SQL' | run_sql
do $$
begin
  begin
    insert into public.money_desk_events values ('FOUNDER_APPROVAL_EMAIL_SENT');
    raise exception 'rollback unexpectedly accepted email outcome';
  exception when check_violation then null;
  end;
end $$;
SQL
echo 'money-desk notice events: red, green, rollback passed'
