-- Minimal disposable PostgreSQL 17 predecessor schema for PAY-003 2a-2c and
-- sync_stripe_payout_profile_readiness. All IDs and rows are synthetic.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema private;

create type public.payout_status as enum (
  'PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELED', 'BLOCKED', 'REVERSED'
);

create table public.payouts (
  id uuid primary key,
  id_text text generated always as (id::text) stored,
  status public.payout_status not null,
  amount integer not null,
  currency text not null,
  provider text not null,
  provider_destination_id text,
  provider_payout_id text,
  provider_response jsonb not null default '{}'::jsonb,
  provider_transfer_status text,
  bank_settlement_status text,
  bank_settlement_failed_at timestamptz,
  bank_settlement_failure_code text,
  blocked_reason text,
  processed_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz
);

create table public.orders (
  id uuid primary key,
  accepted_route_snapshot_at timestamptz
);

create table public.payout_claims (
  id uuid primary key,
  source_kind text not null,
  source_id text not null,
  order_id text not null,
  provider text not null,
  currency text not null,
  amount integer not null,
  status text not null,
  transfer_status text not null,
  payout_id text,
  provider_destination_id text,
  provider_response jsonb not null default '{}'::jsonb
);

create table public.tip_money_operation_claims (
  id uuid primary key,
  payout_id text not null,
  provider_response jsonb not null default '{}'::jsonb
);

create table public.payout_destinations (
  id uuid primary key,
  provider_account_ref text not null
);

create table public.payout_destination_corrections (
  id uuid primary key,
  claim_id uuid not null,
  failed_payout_id text not null,
  replacement_destination_id uuid not null
);

create table public.payout_provider_operations (
  id uuid primary key,
  claim_id uuid not null,
  operation_number integer not null,
  reviewed_correction_id uuid,
  provider_destination_id text,
  status text not null,
  final_failure_reference text,
  funds_return_reference text,
  funds_return_confirmed_at timestamptz
);

create table public.ops_issues (
  issue_type text not null,
  severity text not null,
  status text not null,
  source text not null,
  order_id text not null,
  related_entity_type text not null,
  related_entity_id text not null,
  provider text not null,
  title text not null,
  description text not null,
  recommended_action text not null,
  dedupe_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now()
);

create table public.tailor_profiles (
  id text primary key,
  payout_provider text not null,
  payout_account_type text not null,
  stripe_connect_account_id text not null,
  stripe_account_id text not null,
  payout_account_verified boolean not null default false,
  payout_reverification_required boolean not null default false,
  payout_account_verified_at timestamptz,
  payout_country_code text
);

create function public.guard_tailor_profile_readiness_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.payout_account_verified is distinct from old.payout_account_verified
      or new.payout_reverification_required is distinct from old.payout_reverification_required
      or new.payout_account_verified_at is distinct from old.payout_account_verified_at
      or new.payout_country_code is distinct from old.payout_country_code)
     and coalesce(current_setting('drape.identity_verification_trusted_write', true), '') <> 'true' then
    raise exception 'PROFILE_READINESS_WRITE_REQUIRES_TRUSTED_PATH';
  end if;
  return new;
end;
$$;
create trigger tailor_profile_readiness_write_guard
before update on public.tailor_profiles
for each row execute function public.guard_tailor_profile_readiness_write();
grant update on public.tailor_profiles to service_role;

insert into public.payouts (
  id, status, amount, currency, provider, provider_destination_id,
  provider_response, provider_transfer_status, bank_settlement_status, completed_at
) values
  ('83000000-0000-4000-8000-000000000001', 'FAILED', 1000, 'USD', 'STRIPE', null,
   '{}'::jsonb, 'FAILED', 'NOT_APPLICABLE', null),
  ('83000000-0000-4000-8000-000000000002', 'PAID', 2000, 'USD', 'STRIPE', 'acct-returned',
   '{}'::jsonb, 'AVAILABLE_IN_PROVIDER_BALANCE', 'PENDING', '2026-11-12 12:00:00+00');

insert into public.orders (id, accepted_route_snapshot_at) values
  ('83000000-0000-4000-8000-000000000010', '2026-11-12 12:00:00+00');

insert into public.payout_claims (
  id, source_kind, source_id, order_id, provider, currency, amount,
  status, transfer_status, payout_id, provider_destination_id
) values
  ('83000000-0000-4000-8000-000000000011', 'ORDER_EARNING', 'earning-1',
   '83000000-0000-4000-8000-000000000010', 'STRIPE', 'USD', 1000,
   'PENDING', 'PENDING', '83000000-0000-4000-8000-000000000001', 'acct-restored'),
  ('83000000-0000-4000-8000-000000000012', 'SETTLEMENT_TRANCHE', 'tranche-1',
   '83000000-0000-4000-8000-000000000010', 'STRIPE', 'USD', 2000,
   'PROVIDER_PENDING', 'PROVIDER_PENDING', '83000000-0000-4000-8000-000000000002', 'acct-returned');

insert into public.payout_provider_operations (
  id, claim_id, operation_number, provider_destination_id, status,
  final_failure_reference, funds_return_reference, funds_return_confirmed_at
) values (
  '83000000-0000-4000-8000-000000000013',
  '83000000-0000-4000-8000-000000000012', 1, 'acct-returned', 'FAILED_RETURNED',
  'provider-final-failure-1', 'provider-return-1', '2026-11-12 12:01:00+00'
);

insert into public.tailor_profiles (
  id, payout_provider, payout_account_type, stripe_connect_account_id,
  stripe_account_id, payout_account_verified, payout_reverification_required,
  payout_account_verified_at, payout_country_code
) values (
  'qa-profile-readiness', 'STRIPE', 'STRIPE_CONNECT', 'acct-ready', 'acct-ready',
  false, true, null, 'US'
);
