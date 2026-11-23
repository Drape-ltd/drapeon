-- Minimal disposable Postgres 17 baseline for the ordered PAY-003 1a-1d
-- rehearsal. It models only the predecessor objects these migrations touch.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create type public.currency as enum ('USD', 'NGN');
create type public.payment_provider as enum ('STRIPE', 'PAYSTACK', 'BACHS');
create type public.order_payment_phase as enum ('INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT');
create type public.order_payment_status as enum (
  'INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'PARTIAL_REFUND', 'REFUNDED'
);

create table public.orders (
  id uuid primary key,
  stage text not null default 'PAYMENT_PENDING',
  payment_provider public.payment_provider,
  payment_intent_id text,
  fulfillment_payment_paid_at timestamptz,
  fulfillment_payment_provider public.payment_provider,
  fulfillment_payment_intent_id text
);

create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  phase public.order_payment_phase not null,
  provider public.payment_provider not null,
  currency public.currency not null,
  amount integer not null check (amount >= 0),
  status public.order_payment_status not null default 'INITIATED',
  idempotency_key text not null unique,
  provider_payment_id text,
  provider_response jsonb not null default '{}'::jsonb,
  refunded_amount integer not null default 0,
  partial_refund_count integer not null default 0,
  last_refund_amount integer,
  last_refund_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_role text,
  order_id uuid,
  event text not null,
  severity text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- These predecessor claim relations are required by the PAY-003 function
-- declarations. The rehearsal tests migration installation and transaction
-- rollback, not claim runtime behavior.
create table public.order_payment_refund_claims (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.order_payments(id),
  provider public.payment_provider not null,
  status text not null,
  provider_refund_id text,
  refund_amount integer not null,
  refunded_before integer not null,
  refund_context jsonb,
  refund_claim_id uuid
);

create table public.order_payment_refund_attempts (
  id uuid primary key default gen_random_uuid(),
  refund_claim_id uuid not null references public.order_payment_refund_claims(id),
  provider_reference text not null,
  provider_refund_id text,
  status text not null
);

create function public.snapshot_ready_made_payment_route(
  text, uuid, uuid, integer, uuid, integer, uuid, text, text
) returns jsonb
language sql
security invoker
set search_path = public
as $$ select '{}'::jsonb $$;

revoke all on function public.snapshot_ready_made_payment_route(
  text, uuid, uuid, integer, uuid, integer, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.snapshot_ready_made_payment_route(
  text, uuid, uuid, integer, uuid, integer, uuid, text, text
) to service_role;

insert into public.orders(id) values ('73000000-0000-4000-8000-000000000001');
insert into public.order_payments (
  id, order_id, phase, provider, currency, amount, status, idempotency_key,
  provider_payment_id, refunded_amount, partial_refund_count
) values (
  '73000000-0000-4000-8000-000000000002',
  '73000000-0000-4000-8000-000000000001', 'INITIAL_ORDER', 'STRIPE', 'USD', 1000,
  'PARTIAL_REFUND', 'pay003-rehearsal-seed', 'pi_rehearsal_seed', 250, 1
);
