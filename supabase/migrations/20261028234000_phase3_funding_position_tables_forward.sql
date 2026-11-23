-- Production-shaped Phase 1 funding-position foundation. No provider caller
-- may use these tables until their validators and claim guards are restored.
-- Existing Dev tables remain untouched. Production orders use a UUID native ID
-- and a unique text bridge, so text order references target orders(id_text).

create table if not exists public.order_work_funding_sources (
  payment_id uuid primary key references public.order_payments(id) on delete restrict,
  plan_id uuid not null unique references public.order_settlement_plans(id) on delete restrict,
  order_id text not null references public.orders(id_text) on delete restrict,
  currency public.currency not null,
  captured_tailor_amount integer not null check (captured_tailor_amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.order_work_funding_positions (
  id uuid primary key default gen_random_uuid(),
  source_payment_id uuid not null references public.order_work_funding_sources(payment_id) on delete restrict,
  use_kind text not null check (use_kind in ('PAYOUT','REFUND')),
  payout_claim_id uuid references public.payout_claims(id) on delete restrict,
  refund_claim_id uuid references public.order_payment_refund_claims(id) on delete restrict,
  amount integer not null check (amount > 0),
  status text not null default 'RESERVED' check (status in ('RESERVED','PAYOUT_CONFIRMED','REFUND_CONFIRMED')),
  created_at timestamptz not null default now(),
  check ((use_kind='PAYOUT' and payout_claim_id is not null and refund_claim_id is null)
    or (use_kind='REFUND' and refund_claim_id is not null and payout_claim_id is null))
);

create unique index if not exists order_work_funding_positions_payout_idx
  on public.order_work_funding_positions(payout_claim_id) where payout_claim_id is not null;
create unique index if not exists order_work_funding_positions_refund_idx
  on public.order_work_funding_positions(refund_claim_id) where refund_claim_id is not null;
create index if not exists order_work_funding_positions_source_idx
  on public.order_work_funding_positions(source_payment_id);

create table if not exists public.fabric_funding_sources (
  payment_id uuid primary key references public.order_payments(id) on delete restrict,
  allocation_id uuid not null references public.order_fabric_funding_allocations(id) on delete restrict,
  order_id text not null references public.orders(id_text) on delete restrict,
  source_kind text not null check (source_kind in ('INITIAL_ALLOWANCE','CANDIDATE_SHORTFALL')),
  candidate_id uuid references public.order_fabric_candidates(id) on delete restrict,
  currency public.currency not null,
  captured_fabric_amount integer not null check (captured_fabric_amount > 0),
  created_at timestamptz not null default now(),
  check ((source_kind='INITIAL_ALLOWANCE' and candidate_id is null)
    or (source_kind='CANDIDATE_SHORTFALL' and candidate_id is not null))
);

create index if not exists fabric_funding_sources_allocation_idx
  on public.fabric_funding_sources(allocation_id,created_at,payment_id);
create unique index if not exists fabric_funding_sources_candidate_idx
  on public.fabric_funding_sources(candidate_id) where candidate_id is not null;

create table if not exists public.fabric_funding_positions (
  id uuid primary key default gen_random_uuid(),
  source_payment_id uuid not null references public.fabric_funding_sources(payment_id) on delete restrict,
  use_kind text not null check (use_kind in ('PAYOUT','REFUND')),
  payout_claim_id uuid references public.payout_claims(id) on delete restrict,
  refund_claim_id uuid references public.order_payment_refund_claims(id) on delete restrict,
  amount integer not null check (amount > 0),
  status text not null default 'RESERVED' check (status in ('RESERVED','PAYOUT_CONFIRMED','REFUND_CONFIRMED')),
  created_at timestamptz not null default now(),
  check ((use_kind='PAYOUT' and payout_claim_id is not null and refund_claim_id is null)
    or (use_kind='REFUND' and refund_claim_id is not null and payout_claim_id is null))
);

create unique index if not exists fabric_funding_positions_payout_idx
  on public.fabric_funding_positions(source_payment_id,payout_claim_id) where payout_claim_id is not null;
create unique index if not exists fabric_funding_positions_refund_idx
  on public.fabric_funding_positions(source_payment_id,refund_claim_id) where refund_claim_id is not null;

alter table public.order_work_funding_sources enable row level security;
alter table public.order_work_funding_positions enable row level security;
alter table public.fabric_funding_sources enable row level security;
alter table public.fabric_funding_positions enable row level security;

revoke all on public.order_work_funding_sources,public.order_work_funding_positions,
  public.fabric_funding_sources,public.fabric_funding_positions
  from public,anon,authenticated,service_role;
grant select on public.order_work_funding_sources,public.order_work_funding_positions,
  public.fabric_funding_sources,public.fabric_funding_positions to service_role;
