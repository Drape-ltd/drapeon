-- Draft structural foundation for a separately reviewed, same-destination
-- retry after Stripe has definitively confirmed that no transfer was sent.
-- The executable RPC/guard changes must land in this same migration before it
-- is applied anywhere. An operation cannot use this column until those guards
-- are installed, so the existing correction path stays authoritative.

create table public.payout_claim_retry_authorizations (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.payout_claims(id) on delete restrict,
  prior_operation_id uuid not null references public.payout_provider_operations(id) on delete restrict,
  money_desk_request_id uuid not null unique references public.money_desk_requests(id) on delete restrict,
  operation_number integer not null check (operation_number between 2 and 3),
  provider text not null check (provider = 'STRIPE'),
  provider_destination_id text not null check (btrim(provider_destination_id) <> ''),
  currency public.currency not null,
  amount integer not null check (amount > 0),
  provider_source_transaction_id text not null check (btrim(provider_source_transaction_id) <> ''),
  final_failure_reference text not null check (btrim(final_failure_reference) <> ''),
  funds_return_reference text not null check (funds_return_reference like 'NOT_SENT:%'),
  created_at timestamptz not null default now(),
  unique (claim_id, operation_number),
  unique (prior_operation_id)
);

alter table public.payout_claim_retry_authorizations enable row level security;
revoke all on public.payout_claim_retry_authorizations from public, anon, authenticated;
grant select, insert on public.payout_claim_retry_authorizations to service_role;

alter table public.payout_provider_operations
  add column reviewed_retry_id uuid unique
    references public.payout_claim_retry_authorizations(id) on delete restrict;

alter table public.payout_provider_operations
  drop constraint payout_provider_operations_check;
alter table public.payout_provider_operations
  add constraint payout_provider_operations_check check (
    (operation_number = 1 and reviewed_correction_id is null
      and reviewed_retry_id is null and money_desk_request_id is null)
    or
    (operation_number > 1 and money_desk_request_id is not null
      and ((reviewed_correction_id is not null and reviewed_retry_id is null)
        or (reviewed_correction_id is null and reviewed_retry_id is not null)))
  );
