-- Tables touched by the new trigger, using the relevant live column types.
create table public.ops_issues (
  id uuid primary key default gen_random_uuid(),
  issue_number bigint generated always as identity,
  issue_type text not null, severity text not null, status text not null,
  canonical_status text not null, source text not null, user_id text,
  tailor_profile_id text, related_entity_type text, related_entity_id text,
  title text not null, description text not null, recommended_action text not null,
  dedupe_key text not null unique, metadata jsonb not null default '{}'::jsonb,
  queue_key text, owning_team text, priority text not null,
  environment text not null, provenance text not null
);
create table public.ops_audit_logs (
  id uuid primary key default gen_random_uuid(), issue_id uuid not null references public.ops_issues(id),
  action_taken text not null, performed_by text, performed_role text,
  reason text, after_state jsonb
);
create table public.domain_events (
  id uuid primary key default gen_random_uuid(), event_type text not null,
  aggregate_type text not null, aggregate_id text, idempotency_key text not null unique,
  actor_id uuid, actor_role text, order_id uuid, payload jsonb not null,
  metadata jsonb not null
);
create table public.job_queue (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.domain_events(id),
  job_type text not null, priority integer not null, run_at timestamptz not null,
  max_attempts integer not null, dedupe_key text unique, payload jsonb not null
);
-- Existing customer relationships must not be rewritten by a section move.
create table public.orders (id uuid primary key, tailor_id :ID_TYPE not null, stage text not null);
create table public.messages (id uuid primary key, tailor_id :ID_TYPE not null);
create table public.consultations (id uuid primary key, tailor_id :ID_TYPE not null);
create table public.payouts (id uuid primary key, tailor_id :ID_TYPE not null);
create table public.saved_sellers (id uuid primary key, tailor_profile_id :ID_TYPE not null);
create table public.seller_items (id uuid primary key, tailor_profile_id :ID_TYPE not null, is_live boolean not null);
create or replace function public.current_ops_environment() returns text
language sql stable as $$ select 'DEVELOPMENT'::text $$;
