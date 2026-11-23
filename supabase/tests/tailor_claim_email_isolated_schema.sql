create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role authenticator nologin;
create schema auth;
create schema storage;
create schema realtime;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.jwt() to authenticated;
grant execute on function auth.uid() to authenticated;

create table auth.users (
  id uuid primary key,
  email text,
  banned_until timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb
);
create unique index users_email_key on auth.users(email);
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade
);
create table auth.identities (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,
  identity_data jsonb not null default '{}'::jsonb,
  provider text not null
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id text,
  actor_role text,
  event text not null,
  severity text,
  payload jsonb not null default '{}'::jsonb
);

create table public.users (
  id uuid primary key,
  email text
);
create unique index public_users_email_key on public.users(email);

create table public.customer_records (id uuid primary key, owner_id uuid not null);
alter table public.customer_records enable row level security;
create policy customer_records_owner on public.customer_records for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.customer_records to authenticated;

create table public.tailor_profiles (id uuid primary key, user_id uuid not null);
alter table public.tailor_profiles enable row level security;
create policy tailor_profiles_owner on public.tailor_profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.tailor_profiles to authenticated;

-- Payment tables added on main after the original STAFF_DRAFT boundary. The
-- isolated fixture needs only their RLS shape to prove the forward repair
-- stamps the restrictive policy; payment behavior belongs to its own suite.
create table public.order_payment_provider_refunds (id uuid primary key);
alter table public.order_payment_provider_refunds enable row level security;
create policy order_payment_provider_refunds_owner on public.order_payment_provider_refunds
  for all to authenticated using (false) with check (false);

create table public.payment_late_success_refund_operations (id uuid primary key);
alter table public.payment_late_success_refund_operations enable row level security;
create policy payment_late_success_refund_operations_owner on public.payment_late_success_refund_operations
  for all to authenticated using (false) with check (false);

create table public.payment_status_transition_audits (id uuid primary key);
alter table public.payment_status_transition_audits enable row level security;
create policy payment_status_transition_audits_owner on public.payment_status_transition_audits
  for all to authenticated using (false) with check (false);

create table storage.objects (id uuid primary key, owner_id uuid not null);
alter table storage.objects enable row level security;
create policy storage_objects_owner on storage.objects for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

create table realtime.messages (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  extension text not null default 'broadcast'
);
alter table realtime.messages enable row level security;
grant usage on schema realtime to authenticated;
grant select, insert on realtime.messages to authenticated;

create table public.tailor_claim_invites (
  id uuid primary key default gen_random_uuid(),
  tailor_user_id uuid not null references auth.users(id),
  token_hash text unique,
  status text not null,
  expires_at timestamptz
);

