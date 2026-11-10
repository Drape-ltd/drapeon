create extension if not exists pgcrypto;

create table public.tailor_profiles (
  id text primary key default gen_random_uuid()::text,
  display_name text not null,
  ranking_score integer not null default 0,
  avg_rating double precision not null default 0,
  is_live boolean not null default false,
  is_verified boolean not null default false,
  is_test_profile boolean not null default false
);

do $$
declare
  v_id_type text;
begin
  select data_type into v_id_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'tailor_profiles'
    and column_name = 'id';

  if v_id_type is distinct from 'text' then
    raise exception 'Fixture contract drift: tailor_profiles.id must be text, got %', v_id_type;
  end if;
end;
$$;

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
