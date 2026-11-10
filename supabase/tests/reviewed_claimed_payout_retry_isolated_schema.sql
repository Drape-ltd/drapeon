-- Isolated Postgres 17 subset with the live Dev column types used by
-- start_payout_attempt. No real identity or provider object is present.
create extension if not exists pgcrypto;
create type public.currency as enum ('GBP','USD','EUR','NGN','GHS','KES','CAD');

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
