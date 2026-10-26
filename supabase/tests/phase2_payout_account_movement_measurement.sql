-- Dev/local-only rollback test for account-level movement aggregation.
-- All synthetic rows are rolled back; no provider calls are made.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'a0030000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'phase2-account-movement@example.invalid', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"TAILOR","display_name":"Phase 2 Movement QA"}'::jsonb, now(), now()
);

insert into public.tailor_profiles (
  id, user_id, display_name, location, payout_country_code, payout_currency,
  payout_provider, is_test_profile, is_live, is_verified
) values (
  'a0030000-0000-4000-8000-000000000002',
  'a0030000-0000-4000-8000-000000000001',
  'Phase 2 Movement QA', 'Test-only', 'US', 'USD', 'STRIPE', true, false, false
);

insert into public.payouts (
  id, tailor_profile_id, amount, currency, provider, provider_transfer_status,
  bank_settlement_status, provider_destination_id, payout_purpose, status,
  processed_at, initiated_at
) values
  ('a0030000-0000-4000-8000-000000000011', 'a0030000-0000-4000-8000-000000000002', 1000, 'USD', 'STRIPE', 'AVAILABLE_IN_PROVIDER_BALANCE', 'PENDING', 'acct_movement_qa', 'ORDER_EARNING', 'PAID', now(), now()),
  ('a0030000-0000-4000-8000-000000000012', 'a0030000-0000-4000-8000-000000000002', 200, 'USD', 'STRIPE', 'PROCESSING', 'PENDING', 'acct_movement_qa', 'SETTLEMENT_TRANCHE', 'PROCESSING', now(), now()),
  ('a0030000-0000-4000-8000-000000000013', 'a0030000-0000-4000-8000-000000000002', 300, 'USD', 'STRIPE', 'FAILED', 'FAILED', 'acct_movement_qa', 'TIP', 'FAILED', now(), now()),
  ('a0030000-0000-4000-8000-000000000014', 'a0030000-0000-4000-8000-000000000002', 400, 'USD', 'STRIPE', 'AVAILABLE_IN_PROVIDER_BALANCE', 'PENDING', 'acct_movement_qa', 'CONSULTATION_EARNING', 'PAID', now(), now()),
  ('a0030000-0000-4000-8000-000000000015', 'a0030000-0000-4000-8000-000000000002', 500, 'USD', 'STRIPE', 'AVAILABLE_IN_PROVIDER_BALANCE', 'PENDING', 'acct_movement_qa', 'FABRIC_RELEASE', 'PAID', now(), now()),
  ('a0030000-0000-4000-8000-000000000016', 'a0030000-0000-4000-8000-000000000002', 600, 'USD', 'STRIPE', 'AVAILABLE_IN_PROVIDER_BALANCE', 'PENDING', 'acct_movement_qa', 'MATERIAL_ADVANCE', 'PAID', now(), now()),
  ('a0030000-0000-4000-8000-000000000017', 'a0030000-0000-4000-8000-000000000002', 700, 'NGN', 'PAYSTACK', 'PAID_TO_BANK', 'PAID', 'rcpt_movement_qa', 'ORDER_EARNING', 'PAID', now(), now());

insert into public.provider_payout_events (
  provider, provider_event_id, event_type, provider_destination_id,
  provider_bank_payout_id, tailor_profile_id, amount, currency, status,
  occurred_at, processed_at
) values
  ('STRIPE', 'evt_movement_pending', 'payout.created', 'acct_movement_qa', 'po_movement_qa', 'a0030000-0000-4000-8000-000000000002', 250, 'USD', 'PENDING', null, now() + interval '2 minutes'),
  ('STRIPE', 'evt_movement_paid', 'payout.paid', 'acct_movement_qa', 'po_movement_qa', 'a0030000-0000-4000-8000-000000000002', 250, 'USD', 'PAID', null, now()),
  ('STRIPE', 'evt_movement_failed', 'payout.failed', 'acct_movement_qa', 'po_movement_failed_qa', 'a0030000-0000-4000-8000-000000000002', 75, 'USD', 'FAILED', now(), now()),
  ('STRIPE', 'evt_movement_transit', 'payout.updated', 'acct_movement_qa', 'po_movement_transit_qa', 'a0030000-0000-4000-8000-000000000002', 150, 'USD', 'IN_TRANSIT', now(), now()),
  ('STRIPE', 'evt_movement_unlinked', 'payout.paid', 'acct_movement_qa', null, 'a0030000-0000-4000-8000-000000000002', 999, 'USD', 'PAID', now(), now());

update public.provider_payout_events
set payload = jsonb_build_object('created', floor(extract(epoch from now() - interval '10 minutes'))::bigint)
where provider_event_id = 'evt_movement_pending';
update public.provider_payout_events
set payload = jsonb_build_object('created', floor(extract(epoch from now()))::bigint)
where provider_event_id = 'evt_movement_paid';

set local role service_role;
do $test$
declare
  v_row record;
begin
  select * into v_row
  from public.payout_account_movement_summary
  where tailor_profile_id = 'a0030000-0000-4000-8000-000000000002'
    and provider = 'STRIPE'
    and provider_destination_id = 'acct_movement_qa'
    and currency = 'USD';

  if v_row.payout_record_count <> 6 then raise exception 'Expected all Stripe payout purposes, got % payout rows', v_row.payout_record_count; end if;
  if v_row.transferred_to_provider_balance_minor <> 2500 then raise exception 'Expected confirmed balance transfers to include all payout purposes, got %', v_row.transferred_to_provider_balance_minor; end if;
  if v_row.transfer_processing_minor <> 200 then raise exception 'Expected in-flight transfer amount 200, got %', v_row.transfer_processing_minor; end if;
  if v_row.transfer_failed_minor <> 300 then raise exception 'Expected failed transfer amount 300, got %', v_row.transfer_failed_minor; end if;
  if v_row.withdrawal_count <> 3 then raise exception 'Expected three deduplicated withdrawals, got %', v_row.withdrawal_count; end if;
  if v_row.withdrawal_paid_minor <> 250 then raise exception 'Created and paid webhook events must count once, got %', v_row.withdrawal_paid_minor; end if;
  if v_row.withdrawal_in_transit_minor <> 150 then raise exception 'Expected in-transit withdrawal amount 150, got %', v_row.withdrawal_in_transit_minor; end if;
  if v_row.withdrawal_failed_or_canceled_minor <> 75 then raise exception 'Expected failed withdrawal amount 75, got %', v_row.withdrawal_failed_or_canceled_minor; end if;
  if v_row.withdrawal_reference_missing_count <> 1 then raise exception 'Missing provider payout ID must be count-only, got %', v_row.withdrawal_reference_missing_count; end if;
  if v_row.account_link_status <> 'ACCOUNT_LINKED' then raise exception 'Expected linked account movement row'; end if;

  select * into v_row
  from public.payout_account_movement_summary
  where tailor_profile_id = 'a0030000-0000-4000-8000-000000000002'
    and provider = 'PAYSTACK'
    and provider_destination_id = 'rcpt_movement_qa'
    and currency = 'NGN';
  if v_row.transferred_directly_to_bank_minor <> 700 then raise exception 'Direct-to-bank payout should remain separate from provider-balance transfers'; end if;
end
$test$;

do $security$
begin
  if has_table_privilege('anon', 'public.payout_account_movement_summary', 'SELECT')
    or has_table_privilege('authenticated', 'public.payout_account_movement_summary', 'SELECT') then
    raise exception 'Movement view must not be readable by public API roles';
  end if;
  if not has_table_privilege('service_role', 'public.payout_account_movement_summary', 'SELECT') then
    raise exception 'Ops service role must read the movement view';
  end if;
end
$security$;

rollback;
