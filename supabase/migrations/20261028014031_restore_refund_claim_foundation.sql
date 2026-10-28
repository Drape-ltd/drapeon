-- The Phase 1 refund claim source did not accompany the promoted web/Edge code.
-- Restore the durable, exact-payment reservation table without replaying money.
create table if not exists public.order_payment_refund_claims (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.order_payments(id) on delete restrict,
  order_id text not null,
  phase public.order_payment_phase not null,
  provider public.payment_provider not null,
  currency public.currency not null,
  charged_amount integer not null check (charged_amount > 0),
  refunded_before integer not null check (refunded_before >= 0),
  refund_amount integer not null check (refund_amount > 0),
  provider_payment_id text not null check (length(provider_payment_id) > 0),
  operation_key text not null unique check (length(operation_key) > 0),
  status text not null default 'RESERVED' check (status in (
    'RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED_RECONCILED'
  )),
  provider_refund_id text,
  provider_evidence jsonb not null default '{}'::jsonb,
  refund_context jsonb check (refund_context is null or (
    jsonb_typeof(refund_context) = 'object' and pg_column_size(refund_context) <= 8192
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, refunded_before),
  check (refunded_before + refund_amount <= charged_amount),
  constraint order_payment_refund_claims_context_before_provider_check
    check (status = 'RESERVED' or refund_context is not null)
);

create index if not exists order_payment_refund_claims_order_idx
  on public.order_payment_refund_claims(order_id, created_at desc);
alter table public.order_payment_refund_claims enable row level security;
revoke all on public.order_payment_refund_claims from public, anon, authenticated;
grant select, insert, update on public.order_payment_refund_claims to service_role;

comment on table public.order_payment_refund_claims is
  'One durable refund reservation at an exact captured-payment position. Provider I/O occurs after the reservation commits.';
