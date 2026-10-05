-- Private per-account guide preferences. Writes are validated by education-action.
create table if not exists public.education_preferences (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 100000),
  updated_at timestamptz not null default now()
);
alter table public.education_preferences enable row level security;
create policy education_preferences_owner_read on public.education_preferences
  for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.education_preferences from anon, authenticated;
grant select on public.education_preferences to authenticated;
grant all on public.education_preferences to service_role;
