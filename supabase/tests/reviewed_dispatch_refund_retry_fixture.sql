-- Isolated Postgres fixture with the Dev column types used by the reviewed
-- retry RPC. No Stripe request, live order, or money mutation is involved.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create type public.currency as enum ('USD');
create type public.payment_provider as enum ('STRIPE');
create type public.order_payment_phase as enum ('INITIAL_ORDER');
create type public.order_payment_status as enum ('SUCCEEDED','PARTIAL_REFUND','REFUNDED');

create table public.money_desk_requests (
  id uuid primary key default gen_random_uuid(), action_type text not null,
  target_type text not null, target_id text not null, order_id text,
  amount integer, currency public.currency, status text not null,
  action_payload jsonb not null default '{}'::jsonb,
  requester_email text not null, reason text not null,
  approval_count integer not null, required_approval_count integer not null,
  approved_at timestamptz
);
create table public.money_desk_decisions (
  id uuid primary key default gen_random_uuid(), request_id uuid not null,
  decision text not null, approver_email text not null
);
create table public.money_desk_execution_attempts (
  id uuid primary key default gen_random_uuid(), request_id uuid not null,
  status text not null
);
create table public.order_fulfillment_runs (
  id uuid primary key default gen_random_uuid(), order_id text not null,
  currency public.currency not null, customer_refund_amount integer not null,
  customer_refund_tax_amount integer not null, customer_refund_status text not null
);
create table public.order_payments (
  id uuid primary key default gen_random_uuid(), order_id text not null,
  provider public.payment_provider not null, phase public.order_payment_phase not null,
  currency public.currency not null, status public.order_payment_status not null,
  amount integer not null, refunded_amount integer not null,
  provider_payment_id text
);
create table public.ops_issues (
  id uuid primary key default gen_random_uuid(), dedupe_key text not null unique,
  status text not null, order_id text, metadata jsonb not null default '{}'::jsonb
);
create table public.ops_audit_logs (
  id uuid primary key default gen_random_uuid(), issue_id uuid not null,
  action_taken text not null, performed_by text, performed_role text,
  reason text, before_state jsonb, after_state jsonb
);
create table public.job_queue (
  id uuid primary key default gen_random_uuid(), job_type text not null,
  status text not null, priority integer not null, run_at timestamptz not null,
  max_attempts integer not null, dedupe_key text, payload jsonb not null
);
