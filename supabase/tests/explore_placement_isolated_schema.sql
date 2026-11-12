-- Minimal isolated schema for the Explore placement migrations. Baseline
-- functions are loaded from the rollback files (exact live Dev definitions).
-- The shell proof supplies ID_TYPE=text (Dev) or ID_TYPE=uuid (Production).
create extension if not exists pgcrypto;

create table public.tailor_profiles (
  id :ID_TYPE primary key,
  user_id :ID_TYPE not null unique,
  display_name text,
  id_verification_status text not null default 'PENDING',
  id_verification_method text,
  is_verified boolean not null default false,
  is_live boolean not null default false,
  is_test_profile boolean not null default false,
  ranking_score integer,
  avg_rating numeric,
  id_verified_at timestamptz,
  id_verification_rejection_reason text,
  id_verification_rejected_at timestamptz,
  id_verification_metadata jsonb,
  supports_custom_orders boolean not null default true,
  updated_at timestamptz
);

create table public.audit_logs (
  id bigserial primary key,
  actor_id text,
  actor_role text,
  order_id text,
  event text,
  severity text,
  payload jsonb
);

grant usage on schema public to anon, authenticated, service_role;
grant select, update on public.tailor_profiles to authenticated;
