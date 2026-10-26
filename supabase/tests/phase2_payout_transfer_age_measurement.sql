-- Dev/local-only verification of provider-confirmation observation and the
-- account/purpose age buckets. All synthetic rows are rolled back.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'a0040000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'phase2-transfer-age@example.invalid', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"TAILOR","display_name":"Phase 2 Transfer Age QA"}'::jsonb, now(), now()
);

insert into public.tailor_profiles (
  id, user_id, display_name, location, payout_country_code, payout_currency,
  payout_provider, is_test_profile, is_live, is_verified
) values (
  'a0040000-0000-4000-8000-000000000002',
  'a0040000-0000-4000-8000-000000000001',
  'Phase 2 Transfer Age QA', 'Test-only', 'US', 'USD', 'STRIPE', true, false, false
);

insert into public.payouts (
  id, tailor_profile_id, amount, currency, provider, provider_transfer_status,
  bank_settlement_status, provider_destination_id, payout_purpose, status,
  processed_at, initiated_at, completed_at
) values
  ('a0040000-0000-4000-8000-000000000011', 'a0040000-0000-4000-8000-000000000002', 1000, 'USD', 'STRIPE', 'AVAILABLE_IN_PROVIDER_BALANCE', 'PENDING', 'acct_age_qa', 'TIP', 'PAID', now(), now(), now() - interval '1 day'),
  ('a0040000-0000-4000-8000-000000000012', 'a0040000-0000-4000-8000-000000000002', 400, 'USD', 'STRIPE', 'AVAILABLE_IN_PROVIDER_BALANCE', 'PENDING', 'acct_age_qa', 'TIP', 'PAID', now(), now(), now() - interval '10 days'),
  ('a0040000-0000-4000-8000-000000000013', 'a0040000-0000-4000-8000-000000000002', 500, 'USD', 'STRIPE', 'AVAILABLE_IN_PROVIDER_BALANCE', 'PENDING', 'acct_age_qa', 'TIP', 'PAID', now(), now(), now() - interval '60 days'),
  ('a0040000-0000-4000-8000-000000000014', 'a0040000-0000-4000-8000-000000000002', 600, 'USD', 'STRIPE', 'AVAILABLE_IN_PROVIDER_BALANCE', 'PENDING', 'acct_age_qa', 'TIP', 'PAID', now(), now(), now() - interval '130 days'),
  ('a0040000-0000-4000-8000-000000000015', 'a0040000-0000-4000-8000-000000000002', 200, 'USD', 'STRIPE', 'PROCESSING', 'PENDING', 'acct_age_qa', 'TIP', 'PROCESSING', now(), now(), null),
  ('a0040000-0000-4000-8000-000000000016', 'a0040000-0000-4000-8000-000000000002', 700, 'NGN', 'PAYSTACK', 'PAID_TO_BANK', 'PAID', 'rcpt_age_qa', 'TIP', 'PAID', now(), now(), now() - interval '2 days');

do $test$
declare
  v_row record;
  v_before timestamptz;
  v_after timestamptz;
begin
  select * into v_row
  from public.payout_account_purpose_movement_summary
  where tailor_profile_id = 'a0040000-0000-4000-8000-000000000002'
    and provider = 'STRIPE'
    and provider_destination_id = 'acct_age_qa'
    and currency = 'USD'
    and payout_purpose = 'TIP';

  if v_row.confirmed_transfer_0_to_3d_minor <> 1000 then raise exception '0–3d transfer bucket mismatch: %', v_row.confirmed_transfer_0_to_3d_minor; end if;
  if v_row.confirmed_transfer_4_to_14d_minor <> 400 then raise exception '4–14d transfer bucket mismatch: %', v_row.confirmed_transfer_4_to_14d_minor; end if;
  if v_row.confirmed_transfer_15_to_120d_minor <> 500 then raise exception '15–120d transfer bucket mismatch: %', v_row.confirmed_transfer_15_to_120d_minor; end if;
  if v_row.confirmed_transfer_over_120d_minor <> 600 then raise exception '>120d transfer bucket mismatch: %', v_row.confirmed_transfer_over_120d_minor; end if;
  if v_row.transfer_processing_minor <> 200 then raise exception 'In-flight transfer processing amount mismatch: %', v_row.transfer_processing_minor; end if;
  if v_row.confirmed_transfer_age_unknown_count <> 0 then raise exception 'New confirmed transfer must have an observation time'; end if;

  select * into v_row
  from public.payout_account_purpose_movement_summary
  where tailor_profile_id = 'a0040000-0000-4000-8000-000000000002'
    and provider = 'PAYSTACK'
    and provider_destination_id = 'rcpt_age_qa'
    and currency = 'NGN'
    and payout_purpose = 'TIP';
  if v_row.confirmed_transfer_0_to_3d_minor <> 700 then raise exception 'Legacy direct-to-bank transfer age mismatch'; end if;

  -- The trigger stamps on the first confirmed status observation and must not
  -- move that timestamp when the same confirmed state is replayed.
  insert into public.payouts (
    id, tailor_profile_id, amount, currency, provider, provider_transfer_status,
    bank_settlement_status, provider_destination_id, payout_purpose, status,
    processed_at, initiated_at
  ) values (
    'a0040000-0000-4000-8000-000000000017',
    'a0040000-0000-4000-8000-000000000002', 50, 'USD', 'STRIPE', 'PROCESSING',
    'PENDING', 'acct_transition_qa', 'TIP', 'PROCESSING', now(), now()
  );
  update public.payouts
  set provider_transfer_status = 'AVAILABLE_IN_PROVIDER_BALANCE', status = 'PAID'
  where id = 'a0040000-0000-4000-8000-000000000017';
  select provider_transfer_confirmed_observed_at into v_before
  from public.payouts where id = 'a0040000-0000-4000-8000-000000000017';
  if v_before is null then raise exception 'First provider-confirmed observation was not recorded'; end if;
  update public.payouts
  set provider_transfer_status = 'AVAILABLE_IN_PROVIDER_BALANCE',
      completed_at = v_before + interval '1 day'
  where id = 'a0040000-0000-4000-8000-000000000017';
  select provider_transfer_confirmed_observed_at into v_after
  from public.payouts where id = 'a0040000-0000-4000-8000-000000000017';
  if v_after is distinct from v_before then raise exception 'Replay changed first transfer confirmation observation'; end if;

  if has_table_privilege('anon', 'public.payout_account_purpose_movement_summary', 'SELECT')
    or has_table_privilege('authenticated', 'public.payout_account_purpose_movement_summary', 'SELECT') then
    raise exception 'Age summary must not be readable by public API roles';
  end if;
  if not has_table_privilege('service_role', 'public.payout_account_purpose_movement_summary', 'SELECT') then
    raise exception 'Ops service role must read the age summary';
  end if;
end
$test$;

rollback;
