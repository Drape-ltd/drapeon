-- A replacement transfer is a new provider operation under the same earning
-- claim, never another earning. Only a finally returned, reconciled operation
-- can free the claim for a reviewed replacement.
create table if not exists public.payout_provider_operations (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.payout_claims(id) on delete restrict,
  operation_number integer not null check (operation_number between 1 and 3),
  provider text not null check (nullif(btrim(provider), '') is not null),
  provider_destination_id text not null check (nullif(btrim(provider_destination_id), '') is not null),
  currency public.currency not null,
  amount integer not null check (amount > 0),
  provider_idempotency_key text not null unique,
  status text not null default 'RESERVED' check (status in (
    'RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'TRANSFERRED',
    'WITHDRAWN', 'FAILED_RETURNED', 'LATE_SUCCEEDED'
  )),
  reviewed_correction_id uuid references public.payout_destination_corrections(id) on delete restrict,
  money_desk_request_id uuid references public.money_desk_requests(id) on delete restrict,
  final_failure_reference text,
  funds_return_reference text,
  funds_return_confirmed_at timestamptz,
  provider_transfer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (claim_id, operation_number),
  unique (money_desk_request_id),
  check (
    (operation_number = 1 and reviewed_correction_id is null and money_desk_request_id is null)
    or (operation_number > 1 and reviewed_correction_id is not null and money_desk_request_id is not null)
  ),
  check (status <> 'FAILED_RETURNED' or (
    nullif(btrim(final_failure_reference), '') is not null
    and nullif(btrim(funds_return_reference), '') is not null
    and funds_return_confirmed_at is not null
  ))
);

create unique index if not exists payout_provider_operations_one_live_idx
  on public.payout_provider_operations(claim_id)
  where status in ('RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'TRANSFERRED', 'WITHDRAWN');
create index if not exists payout_provider_operations_claim_created_idx
  on public.payout_provider_operations(claim_id, created_at desc);

alter table public.payout_provider_operations enable row level security;
revoke all on public.payout_provider_operations from public, anon, authenticated;
grant select, insert, update on public.payout_provider_operations to service_role;

alter table public.payout_attempts
  add column if not exists claim_operation_id uuid
  references public.payout_provider_operations(id) on delete restrict;

create or replace function public.prevent_payout_provider_operation_identity_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if row(new.claim_id, new.operation_number, new.provider, new.provider_destination_id,
         new.currency, new.amount, new.provider_idempotency_key, new.reviewed_correction_id,
         new.money_desk_request_id)
    is distinct from
     row(old.claim_id, old.operation_number, old.provider, old.provider_destination_id,
         old.currency, old.amount, old.provider_idempotency_key, old.reviewed_correction_id,
         old.money_desk_request_id) then
    raise exception 'Provider operation identity cannot change';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.payout_provider_operations'::regclass
      and tgname = 'payout_provider_operation_identity_immutable' and not tgisinternal
  ) then
    create trigger payout_provider_operation_identity_immutable
      before update on public.payout_provider_operations
      for each row execute function public.prevent_payout_provider_operation_identity_change();
  end if;
end $$;

revoke all on function public.prevent_payout_provider_operation_identity_change()
  from public, anon, authenticated;
