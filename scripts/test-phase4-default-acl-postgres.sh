#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migration="$repo_root/supabase/migrations/20261126080246_harden_postgres_public_default_privileges.sql"
container="drape-phase4-default-acl-$$"
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

run_sql() {
  docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
}

cat <<'SQL' | run_sql >"$logs/setup.log"
create role anon;
create role authenticated;
create role service_role;
create role supabase_admin;
create table public.ops_runtime_configuration (
  singleton boolean primary key default true,
  environment text not null,
  project_ref text
);
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;
SQL

# A wrong project must fail before changing any defaults.
{
  printf "begin; insert into public.ops_runtime_configuration values (true,'PRODUCTION','wrong-project');\n"
  cat "$migration"
  printf 'rollback;\n'
} | run_sql >"$logs/wrong-project.log" 2>&1 && {
  echo 'Wrong-project guard unexpectedly passed.' >&2
  exit 1
}
grep -q 'PHASE4_DEFAULT_ACL_PROJECT_GUARD' "$logs/wrong-project.log"

{
  printf "begin; insert into public.ops_runtime_configuration values (true,'PRODUCTION','wkfsrunetmgjdtcurmoj');\n"
  cat "$migration"
  printf '\n'
  cat "$migration" # idempotent reapply
  cat <<'SQL'
create table public.phase4_acl_probe_table(id integer);
create sequence public.phase4_acl_probe_seq;
create function public.phase4_acl_probe_function() returns integer language sql as 'select 1';
do $check$
begin
  if has_table_privilege('anon','public.phase4_acl_probe_table','SELECT')
     or has_table_privilege('authenticated','public.phase4_acl_probe_table','SELECT')
     or has_sequence_privilege('anon','public.phase4_acl_probe_seq','USAGE')
     or has_function_privilege('anon','public.phase4_acl_probe_function()','EXECUTE')
     or has_function_privilege('public','public.phase4_acl_probe_function()','EXECUTE') then
    raise exception 'PHASE4_DEFAULT_ACL_PROBE_EXPOSED';
  end if;
  if exists (
    select 1 from pg_default_acl d
    join pg_roles r on r.oid=d.defaclrole
    left join pg_namespace n on n.oid=d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where r.rolname='postgres'
      and (n.nspname='public' or n.nspname is null)
      and (a.grantee=0 or a.grantee in ('anon'::regrole,'authenticated'::regrole))
  ) then
    raise exception 'PHASE4_DEFAULT_ACL_CATALOG_EXPOSED';
  end if;
end;
$check$;
rollback;
SQL
} | run_sql >"$logs/apply.log" 2>&1 || {
  tail -n 50 "$logs/apply.log" >&2
  exit 1
}

echo 'Phase 4 default ACL: project guard, apply/reapply, new-object privileges and rollback-only rehearsal passed.'
