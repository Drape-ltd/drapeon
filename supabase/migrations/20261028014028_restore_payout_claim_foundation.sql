-- Phase 1 claims were rehearsed in Dev but never landed in the source promoted
-- to Production. Restore the additive, provider-neutral foundation before Bachs
-- can move money. No existing payout is backfilled or retried by this migration.
create table if not exists public.payout_claims (
  id uuid primary key default gen_random_uuid(),
  business_key text not null unique,
  source_kind text not null check (source_kind in (
    'ORDER_EARNING', 'SETTLEMENT_TRANCHE', 'TIP', 'MATERIAL_ADVANCE',
    'FABRIC_RELEASE', 'CONSULTATION_EARNING', 'RESIDUAL_SETTLEMENT',
    'TAILOR_ADJUSTMENT'
  )),
  source_id text not null,
  order_id text not null references public.orders(id) on delete restrict,
  tailor_profile_id text not null references public.tailor_profiles(id) on delete restrict,
  provider text not null check (nullif(btrim(provider), '') is not null),
  provider_destination_id text not null check (nullif(btrim(provider_destination_id), '') is not null),
  currency public.currency not null,
  amount integer not null check (amount > 0),
  route_version text not null check (nullif(btrim(route_version), '') is not null),
  earning_policy_version text not null check (nullif(btrim(earning_policy_version), '') is not null),
  tailor_terms_version text,
  provider_idempotency_key text not null unique,
  status text not null default 'RESERVED' check (status in (
    'RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'TRANSFERRED',
    'WITHDRAWN', 'FAILED_RECONCILED', 'BLOCKED'
  )),
  transfer_status text not null default 'NOT_STARTED' check (transfer_status in (
    'NOT_STARTED', 'UNKNOWN', 'PENDING', 'CONFIRMED', 'FAILED_RECONCILED'
  )),
  withdrawal_status text not null default 'NOT_STARTED' check (withdrawal_status in (
    'NOT_STARTED', 'PENDING', 'CONFIRMED', 'FAILED', 'NOT_APPLICABLE'
  )),
  payout_id text references public.payouts(id) on delete restrict,
  provider_transfer_id text,
  last_provider_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_kind, source_id)
);

create table if not exists public.payout_attempts (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.payout_claims(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in (
    'PREPARED', 'SENT', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING',
    'SUCCEEDED', 'FAILED_RECONCILED'
  )),
  provider_operation_id text,
  provider_evidence jsonb not null default '{}'::jsonb,
  error_class text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (claim_id, attempt_number)
);

create index if not exists payout_claims_status_created_idx on public.payout_claims(status, created_at);
create index if not exists payout_claims_order_idx on public.payout_claims(order_id, created_at);
create index if not exists payout_claims_tailor_idx on public.payout_claims(tailor_profile_id, created_at);
create index if not exists payout_claims_payout_idx on public.payout_claims(payout_id) where payout_id is not null;
create index if not exists payout_attempts_claim_started_idx on public.payout_attempts(claim_id, started_at desc);

alter table public.payout_claims enable row level security;
alter table public.payout_attempts enable row level security;
revoke all on public.payout_claims, public.payout_attempts from public, anon, authenticated;
grant select, insert, update on public.payout_claims, public.payout_attempts to service_role;

create or replace function public.prevent_payout_claim_identity_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if row(new.business_key, new.source_kind, new.source_id, new.order_id,
         new.tailor_profile_id, new.provider, new.provider_destination_id,
         new.currency, new.amount, new.route_version, new.earning_policy_version,
         new.tailor_terms_version, new.provider_idempotency_key)
    is distinct from
     row(old.business_key, old.source_kind, old.source_id, old.order_id,
         old.tailor_profile_id, old.provider, old.provider_destination_id,
         old.currency, old.amount, old.route_version, old.earning_policy_version,
         old.tailor_terms_version, old.provider_idempotency_key) then
    raise exception 'Accepted payout claim identity cannot change';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.payout_claims'::regclass
      and tgname = 'payout_claim_identity_immutable' and not tgisinternal
  ) then
    create trigger payout_claim_identity_immutable before update on public.payout_claims
      for each row execute function public.prevent_payout_claim_identity_change();
  end if;
end $$;

revoke all on function public.prevent_payout_claim_identity_change() from public, anon, authenticated;
