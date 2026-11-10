create extension if not exists pgcrypto;

create table public.tailor_profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  ranking_score numeric,
  avg_rating numeric,
  is_live boolean not null default false,
  is_verified boolean not null default false,
  is_test_profile boolean not null default false
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id text,
  actor_role text,
  event text not null,
  severity text not null default 'info',
  order_id uuid,
  payload jsonb
);

alter table public.tailor_profiles enable row level security;
alter table public.audit_logs enable row level security;
create policy authenticated_tailor_profile_select on public.tailor_profiles for select to authenticated using (true);
create policy authenticated_tailor_profile_insert on public.tailor_profiles for insert to authenticated with check (true);
create policy authenticated_tailor_profile_update on public.tailor_profiles for update to authenticated using (true) with check (true);
grant select, insert, update on public.tailor_profiles to authenticated;
grant select, insert, update, delete on public.tailor_profiles to service_role;
grant select, insert on public.audit_logs to service_role;
