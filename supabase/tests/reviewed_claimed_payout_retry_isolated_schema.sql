-- Isolated Postgres 17 subset with the live Dev column types used by
-- start_payout_attempt. No real identity or provider object is present.
create extension if not exists pgcrypto;
create type public.currency as enum ('GBP','USD','EUR','NGN','GHS','KES','CAD');
create type public.payout_status as enum
  ('PENDING','PROCESSING','PAID','FAILED','REVERSED','CANCELED','BLOCKED');
create schema payment_internal;
create schema private;

create table public.orders (
  id uuid primary key, id_text text not null unique,
  accepted_route_snapshot_at timestamptz
);
create table public.order_payments (
  id uuid primary key, order_id text not null, phase text not null,
  provider text not null, status text not null, currency public.currency not null,
  amount integer not null, refunded_amount integer not null default 0,
  ledger_recorded_at timestamptz
);
create table public.order_settlement_plans (
  id uuid primary key, order_id text not null, source_payment_id uuid not null,
  currency public.currency not null, status text not null,
  entitlement_amount integer not null, seller_subtotal_amount integer not null,
  excluded_fabric_allowance_amount integer not null default 0
);
create table public.order_work_funding_positions (
  id uuid primary key default gen_random_uuid(), source_payment_id uuid not null,
  payout_claim_id uuid, use_kind text not null, amount integer not null,
  status text not null
);
create table public.order_payment_refund_claims (payment_id uuid, status text);
create table public.disputes (order_id uuid, status text);
create table public.provider_disputes (order_id text, money_movement_blocked boolean);
create table public.ops_issues (
  id uuid primary key default gen_random_uuid(), issue_type text not null,
  severity text not null, status text not null, source text not null,
  order_id text, related_entity_type text, related_entity_id text,
  provider text, title text not null, description text not null,
  recommended_action text not null, dedupe_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now()
);
create table public.order_payment_provider_refunds (
  payment_id uuid, status text, amount integer, provider text, provider_refund_id text
);
create table public.commercial_ledger_transactions (
  id uuid primary key, payment_id uuid, order_id text, transaction_kind text,
  purpose text, original_amount integer, settlement_amount integer,
  original_currency public.currency, settlement_currency public.currency,
  reversal_of_transaction_id uuid, provider_reference text
);
create table public.commercial_ledger_entries (
  transaction_id uuid, direction text, amount integer,
  currency public.currency, account_code text
);

create table public.payout_destinations (
  id uuid primary key,
  provider_account_ref text not null
);

create table public.payouts (
  id text primary key,
  id_text text generated always as (id) stored,
  order_id text not null,
  settlement_tranche_id uuid,
  source_payment_id uuid,
  provider text not null default 'STRIPE',
  provider_payout_id text,
  payout_purpose text not null,
  provider_destination_id text,
  amount integer not null,
  currency public.currency not null,
  status public.payout_status not null,
  provider_transfer_status text,
  bank_settlement_status text,
  failed_at timestamptz,
  completed_at timestamptz,
  provider_response jsonb
);

create table public.order_settlement_tranches (
  id uuid primary key,
  plan_id uuid,
  order_id text not null,
  amount integer not null,
  currency public.currency not null,
  status text not null,
  payout_id text,
  money_desk_request_id uuid,
  updated_at timestamptz not null default now()
);

create table public.payout_claims (
  id uuid primary key default gen_random_uuid(),
  business_key text not null,
  source_kind text not null,
  source_id text not null,
  order_id text not null,
  tailor_profile_id text not null,
  provider text not null,
  provider_destination_id text not null,
  currency public.currency not null,
  amount integer not null,
  route_version text not null,
  earning_policy_version text not null,
  tailor_terms_version text,
  provider_idempotency_key text not null,
  status text not null default 'RESERVED',
  transfer_status text not null default 'NOT_STARTED',
  withdrawal_status text not null default 'NOT_STARTED',
  payout_id text,
  provider_transfer_id text,
  last_provider_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payout_ledger_transaction_id uuid
);

create table public.payout_provider_operations (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.payout_claims(id),
  operation_number integer not null,
  provider text not null,
  provider_destination_id text not null,
  currency public.currency not null,
  amount integer not null,
  provider_idempotency_key text not null,
  status text not null default 'RESERVED',
  reviewed_correction_id uuid,
  money_desk_request_id uuid,
  final_failure_reference text,
  funds_return_reference text,
  funds_return_confirmed_at timestamptz,
  provider_transfer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider_source_transaction_id text,
  unique (claim_id, operation_number),
  unique (provider_idempotency_key)
);

create table public.payout_attempts (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.payout_claims(id),
  attempt_number integer not null,
  status text not null,
  provider_operation_id text,
  provider_evidence jsonb not null default '{}'::jsonb,
  error_class text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  claim_operation_id uuid references public.payout_provider_operations(id),
  observed_provider_transfer_ids text[] not null default '{}',
  unique (claim_id, attempt_number)
);
