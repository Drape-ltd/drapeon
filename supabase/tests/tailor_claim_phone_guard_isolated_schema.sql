create extension if not exists pgcrypto;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table auth.users(
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb default '{}'::jsonb,
  banned_until timestamptz
);
create table public.users(
  id uuid primary key,email text,phone text,display_name text,role text,
  phone_verified_at timestamptz,updated_at timestamptz
);
create table public.customer_profiles(user_id uuid primary key,phone text);
create table public.tailor_profiles(
  id uuid primary key,user_id uuid,profile_completed boolean,display_name text,location text,
  id_verification_status text,avatar_url text,lifecycle_state text,updated_at timestamptz
);
create table public.tailor_claim_invites(
  id uuid primary key,tailor_user_id uuid,tailor_profile_id uuid,token_hash text,status text,
  expires_at timestamptz,claimed_at timestamptz,consent_recorded_at timestamptz,
  consent_text_version text,consent_media_manifest jsonb,updated_at timestamptz
);
create table public.tailor_claim_bootstrap_sessions(
  id uuid primary key,invite_id uuid,user_id uuid,auth_session_id uuid,status text,
  expires_at timestamptz,updated_at timestamptz,activated_at timestamptz,completed_at timestamptz
);
create table public.tailor_claim_transition_receipts(
  id uuid primary key,invite_id uuid,user_id uuid,bootstrap_session_id uuid,
  idempotency_key text,outcome text,request_payload jsonb,response_payload jsonb,
  failure_code text,created_at timestamptz default now(),completed_at timestamptz,
  auth_handover_at timestamptz
);
create table public.tailor_pickup_details(
  user_id uuid primary key,pickup_address text,pickup_address_line1 text,pickup_city text,
  pickup_region text,pickup_postal_code text,pickup_country_code text,
  pickup_location_verification_source text,pickup_location_verification_reference text,
  pickup_location_verified_at timestamptz,updated_at timestamptz
);
create table public.audit_logs(
  id uuid primary key default gen_random_uuid(),actor_id text,actor_role text,event text,
  severity text,payload jsonb
);

create function public.normalize_account_phone_e164(raw_phone text) returns text
language sql immutable as $$
  select case when raw_phone ~ '^\+[1-9][0-9]{7,14}$' then raw_phone else null end
$$;

create function public.prepare_tailor_profile_claim_v1(
  p_token_hash text,p_bootstrap_session_id uuid,p_user_id uuid,p_auth_session_id uuid,
  p_idempotency_key text,p_email text,p_email_hash text,p_phone text,p_pickup_address text,
  p_pickup_address_line1 text,p_pickup_city text,p_pickup_region text,p_pickup_postal_code text,
  p_pickup_country_code text,p_consent_text_version text,p_consent_media_manifest jsonb
) returns table(result text,receipt_id uuid,invite_id uuid,user_id uuid,response jsonb)
language sql as $$
  select 'PREPARED'::text,null::uuid,null::uuid,p_user_id,null::jsonb
$$;
