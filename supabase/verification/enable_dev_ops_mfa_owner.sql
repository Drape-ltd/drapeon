-- DEV ONLY. Run manually in the Dev SQL editor as the database owner before
-- applying 20261030133137. This bootstrap DDL is intentionally identical to
-- the idempotent schema-parity DDL in that migration, so the owner-only row can
-- exist before the migration while Production receives the empty table only.
begin;

create table if not exists public.dev_ops_mfa_enablement (
  singleton boolean primary key default true check (singleton),
  project_ref text not null check (project_ref = 'pqptfuqogvrajozfsqzi'),
  enabled_at timestamptz not null default now()
);

alter table public.dev_ops_mfa_enablement enable row level security;
revoke all on table public.dev_ops_mfa_enablement from public, anon, authenticated, service_role;

insert into public.dev_ops_mfa_enablement(singleton,project_ref)
values(true,'pqptfuqogvrajozfsqzi')
on conflict(singleton) do update
set project_ref=excluded.project_ref, enabled_at=now();

commit;
