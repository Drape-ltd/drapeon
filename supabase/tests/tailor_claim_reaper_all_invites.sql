create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  banned_until timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb
);
create table auth.sessions (id uuid primary key, user_id uuid not null);
create table public.tailor_profiles (id text primary key, lifecycle_state text, updated_at timestamptz);
create table public.tailor_claim_invites (
  id uuid primary key,
  tailor_profile_id text not null,
  status text not null,
  updated_at timestamptz
);
create table public.tailor_claim_bootstrap_sessions (
  id uuid primary key,
  invite_id uuid not null,
  user_id uuid not null,
  auth_session_id uuid,
  status text not null,
  expires_at timestamptz not null,
  activated_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz
);
create table public.tailor_claim_transition_receipts (
  id uuid primary key,
  invite_id uuid not null,
  bootstrap_session_id uuid not null,
  outcome text not null,
  request_payload jsonb not null,
  auth_handover_at timestamptz,
  failure_code text,
  completed_at timestamptz
);
create table public.audit_logs (
  actor_id text, actor_role text, event text, severity text, payload jsonb
);
create role service_role;
create role anon;
create role authenticated;

insert into auth.users(id,email,raw_app_meta_data) values
  ('00000000-0000-0000-0000-000000000001','draft@example.invalid','{"account_origin":"STAFF_DRAFT"}'),
  ('00000000-0000-0000-0000-000000000002','claimed@example.com','{"account_origin":"CLAIMED"}');
insert into public.tailor_profiles(id,lifecycle_state) values ('profile-1','OPENED'),('profile-2','LIVE');
insert into public.tailor_claim_invites(id,tailor_profile_id,status) values
  ('10000000-0000-0000-0000-000000000001','profile-1','EXPIRED'),
  ('10000000-0000-0000-0000-000000000002','profile-2','LIVE');
insert into auth.sessions(id,user_id) values
  ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
insert into public.tailor_claim_bootstrap_sessions
  (id,invite_id,user_id,auth_session_id,status,expires_at,activated_at) values
  ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','ACTIVE',now()-interval '1 minute',now()-interval '10 minutes'),
  ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','ACTIVE',now()-interval '1 minute',now()-interval '10 minutes');
