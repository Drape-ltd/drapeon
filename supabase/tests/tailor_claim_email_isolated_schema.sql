create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;

create table auth.users (
  id uuid primary key,
  email text
);
create unique index users_email_key on auth.users(email);

create table public.users (
  id uuid primary key,
  email text
);
create unique index public_users_email_key on public.users(email);

create table public.tailor_claim_invites (
  id uuid primary key default gen_random_uuid(),
  tailor_user_id uuid not null references auth.users(id),
  token_hash text unique,
  status text not null,
  expires_at timestamptz
);

