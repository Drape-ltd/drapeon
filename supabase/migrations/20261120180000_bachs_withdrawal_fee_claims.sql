-- Account-level withdrawal fee funding. No earning is attributed to a bank withdrawal.
create table if not exists public.bachs_withdrawal_fee_claims (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique check (length(request_key) between 12 and 200),
  payout_destination_id uuid not null references public.payout_destinations(id) on delete restrict,
  provider_account_id text not null check (provider_account_id ~ '^acct_[A-Za-z0-9_-]+$'),
  provider_bank_destination_id text not null check (provider_bank_destination_id ~ '^pd_[A-Za-z0-9_-]+$'),
  currency text not null check (currency = 'NGN'),
  withdrawal_amount_minor integer not null check (withdrawal_amount_minor > 0),
  reserve_amount_minor integer not null check (reserve_amount_minor between 1 and 50000),
  status text not null default 'RESERVED' check (status in (
    'RESERVED','TOPUP_SUBMITTED','TOPUP_PAID','PAYOUT_SUBMITTED',
    'FEE_PENDING','FEE_RECORDED','SWEEP_SUBMITTED','COMPLETE','REVIEW'
  )),
  topup_transfer_id text unique,
  payout_id text unique,
  sweep_transfer_id text unique,
  actual_fee_minor integer check (actual_fee_minor >= 0),
  fee_ledger_transaction_id uuid unique references public.commercial_ledger_transactions(id) on delete restrict,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bachs_withdrawal_fee_claims_fee_cap check (
    actual_fee_minor is null or actual_fee_minor <= reserve_amount_minor
  ),
  constraint bachs_withdrawal_fee_claims_topup_id check (
    topup_transfer_id is null or topup_transfer_id ~ '^tr_[A-Za-z0-9_-]+$'
  ),
  constraint bachs_withdrawal_fee_claims_payout_id check (
    payout_id is null or payout_id ~ '^pay_[A-Za-z0-9_-]+$'
  ),
  constraint bachs_withdrawal_fee_claims_sweep_id check (
    sweep_transfer_id is null or sweep_transfer_id ~ '^tr_[A-Za-z0-9_-]+$'
  )
);

create table if not exists public.bachs_withdrawal_fee_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.bachs_withdrawal_fee_claims(id) on delete restrict,
  old_status text,
  new_status text not null,
  topup_transfer_id text,
  payout_id text,
  sweep_transfer_id text,
  actual_fee_minor integer,
  fee_ledger_transaction_id uuid,
  occurred_at timestamptz not null default now()
);
create index if not exists bachs_withdrawal_fee_events_claim_idx
  on public.bachs_withdrawal_fee_events(claim_id,occurred_at);

create index if not exists bachs_withdrawal_fee_claims_destination_status_idx
  on public.bachs_withdrawal_fee_claims(payout_destination_id,status,created_at);
create unique index if not exists bachs_withdrawal_fee_claims_one_open_destination_idx
  on public.bachs_withdrawal_fee_claims(payout_destination_id)
  where status <> 'COMPLETE';

create or replace function public.guard_bachs_withdrawal_fee_claim()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Bachs withdrawal claims are append-only.';
  end if;
  if tg_op = 'UPDATE' then
    if row(old.id,old.request_key,old.payout_destination_id,old.provider_account_id,
      old.provider_bank_destination_id,old.currency,old.withdrawal_amount_minor,
      old.reserve_amount_minor,old.created_at)
      is distinct from
      row(new.id,new.request_key,new.payout_destination_id,new.provider_account_id,
      new.provider_bank_destination_id,new.currency,new.withdrawal_amount_minor,
      new.reserve_amount_minor,new.created_at) then
      raise exception 'Bachs withdrawal claim identity is immutable.';
    end if;
    if (old.topup_transfer_id is not null and new.topup_transfer_id is distinct from old.topup_transfer_id)
      or (old.payout_id is not null and new.payout_id is distinct from old.payout_id)
      or (old.sweep_transfer_id is not null and new.sweep_transfer_id is distinct from old.sweep_transfer_id)
      or (old.actual_fee_minor is not null and new.actual_fee_minor is distinct from old.actual_fee_minor)
      or (old.fee_ledger_transaction_id is not null and new.fee_ledger_transaction_id is distinct from old.fee_ledger_transaction_id) then
      raise exception 'Bachs withdrawal provider and ledger receipts are immutable.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.guard_bachs_withdrawal_fee_claim() from public, anon, authenticated, service_role;
drop trigger if exists guard_bachs_withdrawal_fee_claim on public.bachs_withdrawal_fee_claims;
create trigger guard_bachs_withdrawal_fee_claim
  before update or delete on public.bachs_withdrawal_fee_claims
  for each row execute function public.guard_bachs_withdrawal_fee_claim();

create or replace function public.audit_bachs_withdrawal_fee_claim()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.bachs_withdrawal_fee_events(
    claim_id,old_status,new_status,topup_transfer_id,payout_id,
    sweep_transfer_id,actual_fee_minor,fee_ledger_transaction_id
  ) values (
    new.id,case when tg_op = 'UPDATE' then old.status else null end,
    new.status,new.topup_transfer_id,new.payout_id,new.sweep_transfer_id,
    new.actual_fee_minor,new.fee_ledger_transaction_id
  );
  return new;
end;
$$;
revoke all on function public.audit_bachs_withdrawal_fee_claim() from public, anon, authenticated, service_role;
drop trigger if exists audit_bachs_withdrawal_fee_claim on public.bachs_withdrawal_fee_claims;
create trigger audit_bachs_withdrawal_fee_claim
  after insert or update on public.bachs_withdrawal_fee_claims
  for each row execute function public.audit_bachs_withdrawal_fee_claim();

alter table public.bachs_withdrawal_fee_claims enable row level security;
alter table public.bachs_withdrawal_fee_events enable row level security;
revoke all on public.bachs_withdrawal_fee_claims from public, anon, authenticated, service_role;
grant select, insert, update on public.bachs_withdrawal_fee_claims to service_role;
revoke all on public.bachs_withdrawal_fee_events from public, anon, authenticated, service_role;
grant select on public.bachs_withdrawal_fee_events to service_role;
