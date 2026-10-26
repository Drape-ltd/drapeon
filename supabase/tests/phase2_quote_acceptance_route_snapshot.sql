-- Local-only acceptance RPC integration test. All fixture writes are rolled back.
begin;

select set_config('app.payment_route_actor_id', '00000000-0000-4000-8000-000000000001', true);
select set_config('app.payment_route_change_reason', 'Phase 2 route-snapshot integration test', true);

do $test$
declare
  v_customer_id uuid := '00000000-0000-4000-8000-000000000001';
  v_tailor_user_id uuid := '00000000-0000-4000-8000-000000000002';
  v_profile_id text := '361e569f-2eea-4189-85ee-7f115059e046';
  v_order_id text := '345fe9b0-8b5a-400c-87ed-21b1956b178b';
  v_route_id uuid := gen_random_uuid();
  v_delivery_rule_id uuid := gen_random_uuid();
  v_destination_id uuid := gen_random_uuid();
  v_quote_id uuid := gen_random_uuid();
  v_result jsonb;
  v_order public.orders%rowtype;
  v_exposure public.order_payment_exposure_measurements%rowtype;
  v_payout_id uuid := gen_random_uuid();
begin
  update public.tailor_profiles
  set payout_country_code = 'US',
      payout_currency = 'USD',
      payout_provider = 'STRIPE'
  where id = v_profile_id;

  update public.orders
  set stage = 'QUOTE_SENT',
      currency = 'USD',
      payment_provider = null,
      tailor_payout_provider_locked = 'STRIPE',
      tailor_payout_currency_locked = 'USD',
      active_quote_id = null,
      active_quote_version = null,
      delivery_country_code = null
  where id::text = v_order_id;

  insert into public.payment_routes (
    id, route_key, version, tailor_country_code, charge_currency, payout_currency,
    provider, legal_entity, status, fees_collector, fee_schedule_version, created_by
  ) values (
    v_route_id, 'test-usd-us-stripe', 1, 'US', 'USD', 'USD', 'STRIPE',
    'O4_GROUP_LLC', 'DISABLED', 'PLATFORM', 'phase2-test-v1', v_customer_id
  );
  update public.payment_routes set status = 'SANDBOX_ONLY' where id = v_route_id;

  insert into public.delivery_country_rules (
    id, country_code, version, status, duties_customer_pays, created_by
  ) values (
    v_delivery_rule_id, 'US', 1, 'DISABLED', true, v_customer_id
  );
  update public.delivery_country_rules set status = 'READY' where id = v_delivery_rule_id;

  insert into public.payout_destinations (
    id, tailor_profile_id, provider, legal_entity, country_code, currency,
    provider_account_ref, transfers_enabled, payouts_enabled, fees_collector,
    first_withdrawal_review_status, active, capability_checked_at
  ) values (
    v_destination_id, v_profile_id, 'STRIPE', 'O4_GROUP_LLC', 'US', 'USD',
    'acct_phase2_route_snapshot_test', true, true, 'PLATFORM', 'CLEARED', true, now()
  );

  insert into public.order_quotes (
    id, order_id, version, status, change_kind, currency, subtotal_amount,
    tax_amount, platform_fee_amount, delivery_fee_amount, total_amount,
    completion_date, created_by, created_by_role
  ) values (
    v_quote_id, v_order_id::uuid, 1, 'ACTIVE', 'INITIAL', 'USD', 12500,
    750, 0, 1200, 14450, now() + interval '14 days', v_tailor_user_id, 'TAILOR'
  );
  update public.orders
  set active_quote_id = v_quote_id, active_quote_version = 1
  where id::text = v_order_id;

  begin
    update public.orders set stage = 'PAYMENT_PENDING' where id::text = v_order_id;
    raise exception 'expected route-snapshot stage gate to reject direct update';
  exception when check_violation then
    null;
  end;

  if has_function_privilege('service_role',
    'public.accept_active_order_quote(text,uuid,uuid,integer)', 'EXECUTE') then
    raise exception 'legacy route-less acceptance RPC must be revoked';
  end if;

  v_result := public.accept_active_order_quote_with_route_snapshot(
    v_order_id, v_customer_id, v_quote_id, 1,
    v_route_id, 1, v_delivery_rule_id, 1, v_destination_id, 'US',
    'terms-of-service-2026-06-05'
  );
  select * into v_order from public.orders where id::text = v_order_id;
  if v_order.stage::text <> 'PAYMENT_PENDING'
    or v_order.accepted_route_snapshot_at is null
    or v_order.payment_route_id <> v_route_id
    or v_order.payout_destination_id <> v_destination_id
    or v_order.delivery_country_rule_id <> v_delivery_rule_id
    or v_order.legal_entity_snapshot <> 'O4_GROUP_LLC'
    or v_order.charge_provider_snapshot <> 'STRIPE'
    or v_order.charge_currency_snapshot <> 'USD'
    or v_order.payment_provider::text <> 'STRIPE'
    or v_order.accepted_earning_amount <> 12500
    or v_order.tailor_terms_version_snapshot <> 'terms-of-service-2026-06-05'
    or v_result->>'stage' <> 'PAYMENT_PENDING' then
    raise exception 'accepted order did not persist the expected route snapshot';
  end if;

  select * into v_exposure
  from public.order_payment_exposure_measurements
  where order_id = v_order.id::text;
  if v_exposure.order_id is null
    or v_exposure.tailor_profile_id <> v_profile_id
    or v_exposure.payment_route_id <> v_route_id
    or v_exposure.payment_route_version <> 1
    or v_exposure.accepted_earning_amount <> 12500
    or v_exposure.charge_currency <> 'USD'
    or v_exposure.payout_currency <> 'USD'
    or v_exposure.cap_limit_amount is not null
    or v_exposure.confirmed_transfer_amount <> 0
    or v_exposure.outstanding_earning_amount <> 12500
    or v_exposure.measurement_status <> 'OPEN' then
    raise exception 'acceptance did not create the no-cap exposure reservation';
  end if;

  insert into public.payouts (
    id, tailor_profile_id, amount, currency, provider, order_id,
    payout_purpose, status, provider_transfer_status
  ) values (
    v_payout_id, v_profile_id, 12500, 'USD', 'STRIPE', v_order.id,
    'ORDER_EARNING', 'PROCESSING', 'PROCESSING'
  );

  select * into v_exposure
  from public.order_payment_exposure_measurements
  where order_id = v_order.id::text;
  if v_exposure.confirmed_transfer_amount <> 0
    or v_exposure.outstanding_earning_amount <> 12500
    or v_exposure.measurement_status <> 'OPEN' then
    raise exception 'unconfirmed transfer incorrectly reduced measured exposure';
  end if;

  update public.payouts
  set status = 'PAID', provider_transfer_status = 'AVAILABLE_IN_PROVIDER_BALANCE'
  where id = v_payout_id;

  select * into v_exposure
  from public.order_payment_exposure_measurements
  where order_id = v_order.id::text;
  if v_exposure.confirmed_transfer_amount <> 12500
    or v_exposure.outstanding_earning_amount <> 0
    or v_exposure.measurement_status <> 'FULLY_RELEASED' then
    raise exception 'provider-confirmed transfer did not update measured exposure';
  end if;

  begin
    update public.orders
    set legal_entity_snapshot = 'DRAPE_MARKETPLACE_LIMITED'
    where id::text = v_order_id;
    raise exception 'expected accepted route snapshot to be immutable';
  exception when check_violation then
    null;
  end;

  raise notice 'PASS: route snapshot and quote acceptance committed atomically';
end;
$test$;

rollback;
