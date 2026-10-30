-- Rollback-only behavioral proof for provider-driven Stripe readiness sync.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '89000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'stripe-readiness@example.invalid', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"TAILOR"}'::jsonb, now(), now()
);

insert into public.tailor_profiles (
  id, user_id, display_name, location, payout_country_code, payout_currency,
  payout_provider, payout_account_type, payout_account_verified,
  payout_reverification_required, payout_account_verified_at,
  stripe_connect_account_id, stripe_account_id, is_test_profile, is_live, is_verified,
  id_verification_status
) values (
  '89000000-0000-4000-8000-000000000002',
  '89000000-0000-4000-8000-000000000001',
  'Stripe Readiness QA', 'Test only', 'US', 'USD', 'STRIPE', 'STRIPE_CONNECT',
  true, false, '2026-10-30T12:00:00Z', 'acct_readiness_qa', 'acct_readiness_qa',
  true, false, true, 'VERIFIED'
);

set local role service_role;

do $test$
declare
  v_result record;
  v_original_updated_at timestamptz;
  v_original_verified_at timestamptz;
begin
  if has_function_privilege('anon', 'public.sync_stripe_payout_profile_readiness(text,text,boolean,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.sync_stripe_payout_profile_readiness(text,text,boolean,text,timestamptz)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.sync_stripe_payout_profile_readiness(text,text,boolean,text,timestamptz)', 'EXECUTE') then
    raise exception 'Stripe readiness RPC grants are not service-role-only';
  end if;

  select updated_at, payout_account_verified_at
    into v_original_updated_at, v_original_verified_at
  from public.tailor_profiles where id='89000000-0000-4000-8000-000000000002';

  select * into v_result from public.sync_stripe_payout_profile_readiness(
    '89000000-0000-4000-8000-000000000002', 'acct_readiness_qa', true, 'US',
    '2026-10-30T13:00:00Z'
  );
  if v_result.transitioned then raise exception 'Identical Stripe refresh performed a write'; end if;
  if (select payout_account_verified_at from public.tailor_profiles where id='89000000-0000-4000-8000-000000000002') is distinct from v_original_verified_at then
    raise exception 'Identical Stripe refresh replaced the verification timestamp';
  end if;
  if (select updated_at from public.tailor_profiles where id='89000000-0000-4000-8000-000000000002') is distinct from v_original_updated_at then
    raise exception 'Identical Stripe refresh changed the profile row';
  end if;

  begin
    update public.tailor_profiles set payout_account_verified_at=now()
    where id='89000000-0000-4000-8000-000000000002';
    raise exception 'Non-provider caller overwrote protected payout readiness';
  exception when others then
    if sqlerrm='Non-provider caller overwrote protected payout readiness' then raise; end if;
  end;

  select * into v_result from public.sync_stripe_payout_profile_readiness(
    '89000000-0000-4000-8000-000000000002', 'acct_readiness_qa', false, 'US',
    '2026-10-30T14:00:00Z'
  );
  if not v_result.transitioned then raise exception 'Lost Stripe readiness was not persisted'; end if;
  if (select payout_account_verified or not payout_reverification_required or payout_account_verified_at is not null
      from public.tailor_profiles where id='89000000-0000-4000-8000-000000000002') then
    raise exception 'Lost Stripe readiness left the profile payout-ready';
  end if;
  if current_setting('drape.identity_verification_trusted_write', true) <> '' then
    raise exception 'Stripe readiness trusted-write flag leaked';
  end if;

  begin
    perform public.sync_stripe_payout_profile_readiness(
      '89000000-0000-4000-8000-000000000002', 'acct_other', true, 'US', now()
    );
    raise exception 'Unpinned Stripe account changed readiness';
  exception when others then
    if sqlerrm='Unpinned Stripe account changed readiness' then raise; end if;
  end;

  raise notice 'PASS: Stripe payout readiness sync is pinned, no-op safe, and guard preserving';
end
$test$;

reset role;
rollback;
