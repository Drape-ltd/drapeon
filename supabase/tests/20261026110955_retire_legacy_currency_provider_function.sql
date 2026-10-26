-- Run after 20261026081200_retire_legacy_currency_provider_function.sql.
-- Uses a temporary table and transaction-local fixture rows only.
begin;

do $$
begin
  if to_regprocedure('public.resolve_payment_provider_for_currency(public.currency)') is not null then
    raise exception 'The duplicate currency-to-provider function still exists';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname <> 'resolve_payment_provider_for_currency'
      and p.prosrc ilike '%resolve_payment_provider_for_currency%'
  ) then
    raise exception 'A public runtime function still references the retired resolver';
  end if;
end;
$$;

create temporary table phase2_provider_trigger_test as
select
  id, currency, payout_currency, payout_provider, payout_account_type,
  payout_account_verified, payout_reverification_required,
  paystack_recipient_code, paystack_account_id,
  stripe_connect_account_id, stripe_account_id, manual_bank_entry
from public.tailor_profiles
where false;

create trigger phase2_provider_trigger_test
before insert or update of payout_currency
on phase2_provider_trigger_test
for each row execute function public.sync_tailor_payout_currency_fields();

insert into phase2_provider_trigger_test (
  id, currency, payout_currency, payout_provider, payout_account_type,
  payout_account_verified, payout_reverification_required,
  stripe_connect_account_id, manual_bank_entry
) values (
  '00000000-0000-4000-8000-000000000001', 'NGN', 'NGN', 'PAYSTACK',
  'STRIPE_CONNECT', true, false, 'acct_test_fixture', false
);

insert into phase2_provider_trigger_test (
  id, currency, payout_currency, payout_provider, payout_account_type,
  payout_account_verified, payout_reverification_required, manual_bank_entry
) values (
  '00000000-0000-4000-8000-000000000002', 'NGN', 'NGN', null,
  null, false, false, false
);

do $$
declare
  actual_provider text;
begin
  select payout_provider::text into actual_provider
  from phase2_provider_trigger_test
  where id = '00000000-0000-4000-8000-000000000001';
  if actual_provider <> 'STRIPE' then
    raise exception 'Explicit Stripe destination did not control legacy metadata (got %)', actual_provider;
  end if;

  select payout_provider::text into actual_provider
  from phase2_provider_trigger_test
  where id = '00000000-0000-4000-8000-000000000002';
  if actual_provider is not null then
    raise exception 'Currency-only profile unexpectedly resolved a provider (got %)', actual_provider;
  end if;
end;
$$;

update phase2_provider_trigger_test
set payout_currency = 'GBP'
where id = '00000000-0000-4000-8000-000000000001';

update phase2_provider_trigger_test
set payout_currency = 'USD'
where id = '00000000-0000-4000-8000-000000000002';

do $$
declare
  actual_provider text;
  needs_reverification boolean;
begin
  select payout_provider::text, payout_reverification_required
    into actual_provider, needs_reverification
  from phase2_provider_trigger_test
  where id = '00000000-0000-4000-8000-000000000001';
  if actual_provider <> 'STRIPE' or not needs_reverification then
    raise exception 'Currency change lost explicit provider or reverification guard';
  end if;

  select payout_provider::text into actual_provider
  from phase2_provider_trigger_test
  where id = '00000000-0000-4000-8000-000000000002';
  if actual_provider is not null then
    raise exception 'Currency change recreated a provider mapping (got %)', actual_provider;
  end if;
end;
$$;

rollback;
