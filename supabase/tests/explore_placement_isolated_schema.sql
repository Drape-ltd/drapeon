-- Minimal isolated schema for the Explore placement migrations. Baseline
-- functions are loaded from the rollback files (exact live Dev definitions).
create extension if not exists pgcrypto;
create type public.marketplace_category as enum ('TAILORING', 'STREETWEAR');

create table public.tailor_profiles (
  id text primary key,
  user_id uuid not null unique,
  display_name text,
  id_verification_status text not null default 'PENDING',
  id_verification_method text,
  is_verified boolean not null default false,
  is_live boolean not null default false,
  id_verified_at timestamptz,
  id_verification_rejection_reason text,
  id_verification_rejected_at timestamptz,
  id_verification_metadata jsonb,
  supports_custom_orders boolean not null default true,
  marketplace_category public.marketplace_category not null default 'TAILORING',
  updated_at timestamptz
);

create table public.marketplace_category_decisions (
  id uuid primary key default gen_random_uuid(),
  tailor_profile_id text not null references public.tailor_profiles(id) on delete cascade,
  from_category public.marketplace_category not null,
  to_category public.marketplace_category not null,
  reason text not null check (char_length(reason) between 12 and 500),
  actor text not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  created_at timestamptz not null default now()
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

grant usage on schema public to authenticated;
grant select, update on public.tailor_profiles to authenticated;
