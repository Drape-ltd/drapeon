-- Additive Phase 1 money-claim foundations absent from Production. Writer
-- functions and guards are a later release; no route is enabled by this file.
-- Text order references use the cross-environment orders.id_text bridge.

create table if not exists public.consultation_money_operation_claims (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.consultation_bookings(id) on delete restrict,
  operation_kind text not null check (operation_kind in ('PAYOUT','REFUND')),
  request_key text not null unique check (nullif(btrim(request_key),'') is not null),
  amount integer not null check (amount > 0),
  currency public.currency not null,
  status text not null default 'RESERVED' check (status in
    ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING','SUCCEEDED','FAILED_RECONCILED')),
  refund_funding_mode text check (refund_funding_mode in ('UNPAID_EARNING','POST_PAYOUT')),
  money_desk_request_id uuid references public.money_desk_requests(id) on delete restrict,
  provider_operation_id text,
  provider_response jsonb not null default '{}'::jsonb,
  provider_checked_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payment_id uuid references public.order_payments(id) on delete restrict,
  provider text,
  check ((operation_kind='PAYOUT' and refund_funding_mode is null and money_desk_request_id is null)
    or (operation_kind='REFUND' and refund_funding_mode is not null))
);

create unique index if not exists consultation_money_one_payout_claim_idx
  on public.consultation_money_operation_claims(booking_id) where operation_kind='PAYOUT';
create index if not exists consultation_money_claims_booking_idx
  on public.consultation_money_operation_claims(booking_id,created_at);
create index if not exists consultation_money_claims_status_idx
  on public.consultation_money_operation_claims(status,created_at);
create index if not exists consultation_money_claims_money_desk_idx
  on public.consultation_money_operation_claims(money_desk_request_id)
  where money_desk_request_id is not null;
create index if not exists consultation_money_claims_payment_idx
  on public.consultation_money_operation_claims(payment_id)
  where payment_id is not null;
create unique index if not exists consultation_money_one_refund_per_approval_idx
  on public.consultation_money_operation_claims(money_desk_request_id)
  where operation_kind='REFUND' and money_desk_request_id is not null;

create table if not exists public.consultation_refund_holds (
  payment_id uuid primary key references public.order_payments(id) on delete restrict,
  order_id text not null references public.orders(id_text) on delete restrict,
  amount integer not null check (amount > 0),
  currency public.currency not null,
  candidate_booking_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  ops_issue_id uuid not null references public.ops_issues(id) on delete restrict,
  resolved_booking_id uuid references public.consultation_bookings(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status='OPEN' and resolved_booking_id is null and resolved_at is null)
    or (status='RESOLVED' and resolved_booking_id is not null and resolved_at is not null))
);

create index if not exists consultation_refund_holds_open_lookup_idx
  on public.consultation_refund_holds(order_id,amount,currency) where status='OPEN';
create index if not exists consultation_refund_holds_issue_idx
  on public.consultation_refund_holds(ops_issue_id);
create index if not exists consultation_refund_holds_resolved_booking_idx
  on public.consultation_refund_holds(resolved_booking_id)
  where resolved_booking_id is not null;

create table if not exists public.adjustment_money_operation_claims (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.commercial_adjustments(id) on delete restrict,
  source_payment_id uuid not null references public.order_payments(id) on delete restrict,
  capture_transaction_id uuid not null references public.commercial_ledger_transactions(id) on delete restrict,
  operation_kind text not null check (operation_kind in ('PAYOUT','REFUND')),
  request_key text not null unique check (nullif(btrim(request_key),'') is not null),
  amount integer not null check (amount > 0),
  currency public.currency not null,
  money_desk_request_id uuid not null unique references public.money_desk_requests(id) on delete restrict,
  refund_funding_mode text check (refund_funding_mode in ('UNPAID_EARNING','DRAPEON_FUNDED_UNPAID','POST_PAYOUT')),
  payout_claim_id uuid references public.payout_claims(id) on delete restrict,
  status text not null default 'RESERVED' check (status in
    ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING','SUCCEEDED',
     'FAILED_RECONCILED','LATE_SUCCEEDED','BLOCKED')),
  provider_operation_id text,
  provider_evidence jsonb not null default '{}'::jsonb,
  provider_checked_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((operation_kind='PAYOUT' and refund_funding_mode is null and payout_claim_id is not null)
    or (operation_kind='REFUND' and refund_funding_mode is not null)),
  check (operation_kind='PAYOUT' or payout_claim_id is null)
);

create unique index if not exists adjustment_money_one_payout_idx
  on public.adjustment_money_operation_claims(adjustment_id) where operation_kind='PAYOUT';
create index if not exists adjustment_money_claims_adjustment_idx
  on public.adjustment_money_operation_claims(adjustment_id,created_at);
create index if not exists adjustment_money_claims_status_idx
  on public.adjustment_money_operation_claims(status,created_at);

alter table public.consultation_money_operation_claims enable row level security;
alter table public.consultation_refund_holds enable row level security;
alter table public.adjustment_money_operation_claims enable row level security;
revoke all on public.consultation_money_operation_claims,public.consultation_refund_holds,
  public.adjustment_money_operation_claims from public,anon,authenticated;
grant select,insert,update on public.consultation_money_operation_claims,
  public.consultation_refund_holds,public.adjustment_money_operation_claims
  to service_role;
