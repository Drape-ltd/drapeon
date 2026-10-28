-- Keep the Phase 1 provider-neutral claim tables portable across projects
-- whose legacy primary keys are either UUID (Production lineage) or text
-- (Development lineage). Existing application contracts store IDs as text.

alter table public.orders
  add column if not exists id_text text generated always as (id::text) stored;
alter table public.tailor_profiles
  add column if not exists id_text text generated always as (id::text) stored;
alter table public.payouts
  add column if not exists id_text text generated always as (id::text) stored;

do $$
begin
  if exists (select 1 from public.orders where id_text is distinct from id::text)
    or exists (select 1 from public.tailor_profiles where id_text is distinct from id::text)
    or exists (select 1 from public.payouts where id_text is distinct from id::text) then
    raise exception 'A generated text identifier does not match its native primary key.';
  end if;
end;
$$;

create unique index if not exists orders_id_text_uidx
  on public.orders (id_text);
create unique index if not exists tailor_profiles_id_text_uidx
  on public.tailor_profiles (id_text);
create unique index if not exists payouts_id_text_key
  on public.payouts (id_text);

-- On Production this creates the missing claim table before the historical
-- restore migration runs. Its CREATE TABLE IF NOT EXISTS then safely skips the
-- incompatible native-key FK declarations while still installing the shared
-- indexes, grants, identity guard, and trigger.
create table if not exists public.payout_claims (
  id uuid primary key default gen_random_uuid(),
  business_key text not null unique,
  source_kind text not null check (source_kind in (
    'ORDER_EARNING', 'SETTLEMENT_TRANCHE', 'TIP', 'MATERIAL_ADVANCE',
    'FABRIC_RELEASE', 'CONSULTATION_EARNING', 'RESIDUAL_SETTLEMENT',
    'TAILOR_ADJUSTMENT'
  )),
  source_id text not null,
  order_id text not null,
  tailor_profile_id text not null,
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
  payout_id text,
  provider_transfer_id text,
  last_provider_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_kind, source_id)
);

-- Normalize the three legacy-ID references without rewriting any stored IDs.
alter table public.payout_claims
  drop constraint if exists payout_claims_order_id_fkey,
  drop constraint if exists payout_claims_tailor_profile_id_fkey,
  drop constraint if exists payout_claims_payout_id_fkey,
  drop constraint if exists payout_claims_order_id_text_fkey,
  drop constraint if exists payout_claims_tailor_profile_id_text_fkey,
  drop constraint if exists payout_claims_payout_id_text_fkey;

alter table public.payout_claims
  add constraint payout_claims_order_id_text_fkey
    foreign key (order_id) references public.orders(id_text) on delete restrict,
  add constraint payout_claims_tailor_profile_id_text_fkey
    foreign key (tailor_profile_id) references public.tailor_profiles(id_text) on delete restrict,
  add constraint payout_claims_payout_id_text_fkey
    foreign key (payout_id) references public.payouts(id_text) on delete restrict;

alter table public.payout_claims enable row level security;
revoke all on public.payout_claims from public, anon, authenticated;
grant select, insert, update on public.payout_claims to service_role;

create index if not exists payout_claims_status_created_idx
  on public.payout_claims(status, created_at);
create index if not exists payout_claims_order_idx
  on public.payout_claims(order_id, created_at);
create index if not exists payout_claims_tailor_idx
  on public.payout_claims(tailor_profile_id, created_at);
create index if not exists payout_claims_payout_idx
  on public.payout_claims(payout_id) where payout_id is not null;

create or replace function public.prevent_payout_claim_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
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
revoke execute on function public.prevent_payout_claim_identity_change()
  from public, anon, authenticated, service_role;
