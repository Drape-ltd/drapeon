-- Transaction-scoped acceptance RPC integration test. All fixture writes are rolled back.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'phase2-route-snapshot-customer@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"role":"CUSTOMER","display_name":"Phase 2 QA Customer"}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'phase2-route-snapshot-tailor@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"role":"TAILOR","display_name":"Phase 2 QA Tailor"}'::jsonb, now(), now());
insert into public.customer_profiles (user_id, display_name)
values ('00000000-0000-4000-8000-000000000001', 'Phase 2 QA Customer');
insert into public.tailor_profiles (
  id, user_id, display_name, location, payout_country_code, payout_currency,
  payout_provider, is_test_profile, is_live, is_verified
) values (
  '361e569f-2eea-4189-85ee-7f115059e046',
  '00000000-0000-4000-8000-000000000002',
  'Phase 2 QA Tailor', 'Test-only', 'US', 'USD', 'STRIPE', true, false, false
);
insert into public.orders (
  id, reference, customer_id, tailor_profile_id, garment_type, description,
  fabric_source, delivery_method, currency, stage
) values (
  '345fe9b0-8b5a-400c-87ed-21b1956b178b',
  'PHASE2-ROUTE-SNAPSHOT-QA',
  '00000000-0000-4000-8000-000000000001',
  '361e569f-2eea-4189-85ee-7f115059e046',
  'Test garment', 'Non-production route snapshot fixture',
  'CUSTOMER_SUPPLIES', 'SHIPPING', 'USD', 'QUOTE_SENT'
);
insert into public.orders (
  id, reference, customer_id, tailor_profile_id, garment_type, description,
  fabric_source, fabric_funding_policy_version, delivery_method, currency,
  stage, delivery_country_code
) values (
  '445fe9b0-8b5a-400c-87ed-21b1956b178b',
  'PHASE2-FUNDED-FABRIC-EARNING-QA',
  '00000000-0000-4000-8000-000000000001',
  '361e569f-2eea-4189-85ee-7f115059e046',
  'Test garment', 'Funded-fabric earnings snapshot fixture',
  'TAILOR_SOURCES', 'fabric-funding-2026-08-21-v2', 'SHIPPING', 'USD',
  'QUOTE_SENT', 'US'
);
insert into public.orders (
  id, reference, customer_id, tailor_profile_id, garment_type, description,
  fabric_source, fabric_funding_policy_version, delivery_method, currency,
  stage, delivery_country_code
) values (
  '545fe9b0-8b5a-400c-87ed-21b1956b178b',
  'PHASE2-FUNDED-FABRIC-V1-EARNING-QA',
  '00000000-0000-4000-8000-000000000001',
  '361e569f-2eea-4189-85ee-7f115059e046',
  'Test garment', 'Funded-fabric v1 earnings snapshot fixture',
  'TAILOR_SOURCES', 'fabric-funding-2026-08-01-v1', 'SHIPPING', 'USD',
  'QUOTE_SENT', 'US'
);
insert into public.ops_workforce_principals (
  id, email, status, roles, permitted_environments, access_review_due_at, created_by
) values (
  'aebd7ede-6620-48f5-b1e5-f96b49392dfe', 'phase2-snapshot-admin@example.invalid',
  'ACTIVE', array['admin']::text[], array['development']::text[], now() + interval '1 day', 'rollback-test'
);

select set_config('app.payment_route_actor_id', '00000000-0000-4000-8000-000000000001', true);
select set_config('app.payment_route_actor_principal_id', 'aebd7ede-6620-48f5-b1e5-f96b49392dfe', true);
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
  v_summary record;
  v_payout_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  v_settlement_plan_id uuid;
  v_tranche_id uuid;
  v_tranche_amount integer;
  v_funded_order_id text := '445fe9b0-8b5a-400c-87ed-21b1956b178b';
  v_funded_quote_id uuid := gen_random_uuid();
  v_funded_payment_id uuid := gen_random_uuid();
  v_funded_plan_id uuid;
  v_funded_order public.orders%rowtype;
  v_fabric_allocation public.order_fabric_funding_allocations%rowtype;
  v_funded_entitlement integer;
  v_funded_tranche_total integer;
  v_constraint_name text;
  v_funded_v1_order_id text := '545fe9b0-8b5a-400c-87ed-21b1956b178b';
  v_funded_v1_quote_id uuid := gen_random_uuid();
  v_funded_v1_order public.orders%rowtype;
  v_funded_v1_allocation public.order_fabric_funding_allocations%rowtype;
begin
  update public.tailor_profiles
  set payout_country_code = 'US',
      payout_currency = 'USD',
      payout_provider = 'STRIPE'
  where id::text = v_profile_id;

  update public.orders
  set stage = 'QUOTE_SENT',
      currency = 'USD',
      payment_provider = null,
      tailor_payout_provider_locked = 'STRIPE',
      tailor_payout_currency_locked = 'USD',
      active_quote_id = null,
      active_quote_version = null,
      delivery_country_code = 'US'
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
    v_destination_id, v_profile_id::uuid, 'STRIPE', 'O4_GROUP_LLC', 'US', 'USD',
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

  -- Funded-fabric quote subtotal includes both tailoring and the protected
  -- fabric allowance. The route snapshot and staged plan must record only the
  -- tailoring allocation as the tailor's earning.
  insert into public.order_quotes (
    id, order_id, version, status, change_kind, currency, subtotal_amount,
    tax_amount, platform_fee_amount, delivery_fee_amount, total_amount,
    completion_date, created_by, created_by_role,
    fabric_funding_policy_version, fabric_source_snapshot, tailoring_amount,
    fabric_allowance_amount, fabric_allowance_currency, fabric_allowance_coverage,
    fabric_sourcing_assumptions, pricing_version
  ) values (
    v_funded_quote_id, v_funded_order_id::uuid, 1, 'ACTIVE', 'INITIAL', 'USD', 12500,
    750, 0, 1200, 14450, now() + interval '14 days', v_tailor_user_id, 'TAILOR',
    'fabric-funding-2026-08-21-v2', 'TAILOR_SOURCES', 10000, 2500, 'USD',
    '[{"component":"main_fabric"}]'::jsonb, 'Fabric allowance reserved for production.', 1
  );
  update public.orders
  set active_quote_id = v_funded_quote_id,
      active_quote_version = 1,
      tailor_payout_provider_locked = 'STRIPE',
      tailor_payout_currency_locked = 'USD'
  where id::text = v_funded_order_id;

  perform public.accept_active_order_quote_with_route_snapshot(
    v_funded_order_id, v_customer_id, v_funded_quote_id, 1,
    v_route_id, 1, v_delivery_rule_id, 1, v_destination_id, 'US',
    'terms-of-service-2026-06-05'
  );
  select * into v_funded_order
  from public.orders
  where id::text = v_funded_order_id;
  select * into v_fabric_allocation
  from public.order_fabric_funding_allocations
  where order_id::text = v_funded_order_id;
  if v_funded_order.accepted_earning_amount <> 10000
    or v_fabric_allocation.tailoring_amount <> 10000
    or v_fabric_allocation.base_allowance_amount <> 2500
    or v_fabric_allocation.seller_subtotal_amount <> 12500 then
    raise exception 'funded-fabric acceptance included protected allowance in tailor earnings';
  end if;

  insert into public.order_payments (
    id, order_id, phase, provider, currency, amount, status, idempotency_key,
    provider_payment_id, confirmed_at, ledger_recorded_at, commercial_breakdown
  ) values (
    v_funded_payment_id, v_funded_order_id::uuid, 'INITIAL_ORDER', 'STRIPE', 'USD', 14450,
    'SUCCEEDED', 'phase2-funded-fabric-route-snapshot:' || v_funded_order_id,
    'pi_phase2_funded_fabric_snapshot_test', now(), now(),
    jsonb_build_object('subtotalAmount', 12500)
  );
  v_funded_plan_id := public.initialize_order_settlement_plan(v_funded_order_id);
  select p.entitlement_amount, coalesce(sum(t.amount), 0)::integer
  into v_funded_entitlement, v_funded_tranche_total
  from public.order_settlement_plans p
  left join public.order_settlement_tranches t on t.plan_id = p.id
  where p.id = v_funded_plan_id
  group by p.entitlement_amount;
  if v_funded_entitlement <> v_funded_order.accepted_earning_amount
    or v_funded_tranche_total <> v_funded_order.accepted_earning_amount then
    raise exception 'funded-fabric payout plan did not match the accepted tailoring earning';
  end if;

  -- Preserve the same earning boundary for the earlier funded-fabric policy.
  insert into public.order_quotes (
    id, order_id, version, status, change_kind, currency, subtotal_amount,
    tax_amount, platform_fee_amount, delivery_fee_amount, total_amount,
    completion_date, created_by, created_by_role,
    fabric_funding_policy_version, fabric_source_snapshot, tailoring_amount,
    fabric_allowance_amount, fabric_allowance_currency, fabric_allowance_coverage,
    fabric_sourcing_assumptions, pricing_version
  ) values (
    v_funded_v1_quote_id, v_funded_v1_order_id::uuid, 1, 'ACTIVE', 'INITIAL', 'USD', 12500,
    750, 0, 1200, 14450, now() + interval '14 days', v_tailor_user_id, 'TAILOR',
    'fabric-funding-2026-08-01-v1', 'TAILOR_SOURCES', 10000, 2500, 'USD',
    '[{"component":"main_fabric"}]'::jsonb, 'Fabric allowance reserved for production.', 1
  );
  update public.orders
  set active_quote_id = v_funded_v1_quote_id,
      active_quote_version = 1,
      tailor_payout_provider_locked = 'STRIPE',
      tailor_payout_currency_locked = 'USD'
  where id::text = v_funded_v1_order_id;

  perform public.accept_active_order_quote_with_route_snapshot(
    v_funded_v1_order_id, v_customer_id, v_funded_v1_quote_id, 1,
    v_route_id, 1, v_delivery_rule_id, 1, v_destination_id, 'US',
    'terms-of-service-2026-06-05'
  );
  select * into v_funded_v1_order
  from public.orders
  where id::text = v_funded_v1_order_id;
  select * into v_funded_v1_allocation
  from public.order_fabric_funding_allocations
  where order_id::text = v_funded_v1_order_id;
  if v_funded_v1_order.accepted_earning_amount <> 10000
    or v_funded_v1_allocation.tailoring_amount <> 10000
    or v_funded_v1_allocation.base_allowance_amount <> 2500
    or v_funded_v1_allocation.seller_subtotal_amount <> 12500 then
    raise exception 'funded-fabric v1 acceptance included protected allowance in tailor earnings';
  end if;

  select * into v_exposure
  from public.order_payment_exposure_measurements
  where order_id::text = v_order.id::text;
  if v_exposure.order_id is null
    or v_exposure.tailor_profile_id::text <> v_profile_id
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

  insert into public.order_payments (
    id, order_id, phase, provider, currency, amount, status, idempotency_key,
    provider_payment_id, confirmed_at, ledger_recorded_at, commercial_breakdown
  ) values (
    v_payment_id, v_order_id::uuid, 'INITIAL_ORDER', 'STRIPE', 'USD', 14450,
    'SUCCEEDED', 'phase2-route-snapshot:' || v_order_id,
    'pi_phase2_route_snapshot_test', now(), now(),
    jsonb_build_object('subtotalAmount', 12500)
  );

  v_settlement_plan_id := public.initialize_order_settlement_plan(v_order_id);
  select id, amount into v_tranche_id, v_tranche_amount
  from public.order_settlement_tranches
  where plan_id = v_settlement_plan_id and sequence = 1;
  if v_tranche_id is null or v_tranche_amount <> 8750 then
    raise exception 'staged settlement plan did not create the expected first tranche';
  end if;

  insert into public.payouts (
    id, tailor_profile_id, amount, currency, provider, order_id,
    payout_purpose, status, provider_transfer_status, settlement_tranche_id
  ) values (
    v_payout_id, v_profile_id::uuid, v_tranche_amount, 'USD', 'STRIPE', v_order.id,
    'SETTLEMENT_TRANCHE', 'PROCESSING', 'PROCESSING', v_tranche_id
  );

  select * into v_exposure
  from public.order_payment_exposure_measurements
  where order_id::text = v_order.id::text;
  if v_exposure.confirmed_transfer_amount <> 0
    or v_exposure.outstanding_earning_amount <> 12500
    or v_exposure.measurement_status <> 'OPEN' then
    raise exception 'unconfirmed transfer incorrectly reduced measured exposure';
  end if;

  update public.payouts
  set status = 'PAID', provider_transfer_status = 'AVAILABLE_IN_PROVIDER_BALANCE'
  where id::text = v_payout_id::text;

  select * into v_exposure
  from public.order_payment_exposure_measurements
  where order_id::text = v_order.id::text;
  if v_exposure.confirmed_transfer_amount <> v_tranche_amount
    or v_exposure.outstanding_earning_amount <> 12500 - v_tranche_amount
    or v_exposure.measurement_status <> 'OPEN' then
    raise exception 'provider-confirmed staged tranche did not update measured exposure';
  end if;

  select * into v_summary
  from public.payout_account_accepted_earning_exposure_summary
  where tailor_profile_id::text = v_profile_id
    and payment_route_id = v_route_id
    and payment_route_version = 1
    and charge_currency = 'USD'
    and payout_currency = 'USD';
  if v_summary.tailor_profile_id is null
    or v_summary.exposed_order_count <> 3
    or v_summary.accepted_earning_minor <> 32500
    or v_summary.confirmed_transfer_minor <> v_tranche_amount
    or v_summary.outstanding_earning_minor <> 32500 - v_tranche_amount
    or v_summary.open_order_count <> 3
    or v_summary.overpaid_order_count <> 0
    or v_summary.currency_mismatch_order_count <> 0 then
    raise exception 'Ops accepted-earning exposure summary did not aggregate accepted snapshots correctly';
  end if;

  begin
    update public.orders
    set legal_entity_snapshot = 'DRAPE_MARKETPLACE_LIMITED'
    where id::text = v_order_id;
    raise exception 'expected accepted route snapshot to be immutable';
  exception when check_violation then
    null;
  end;

  begin
    update public.orders
    set currency = 'NGN'
    where id::text = v_order_id;
    raise exception 'expected accepted charge currency mirror to be immutable';
  exception when check_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name <> 'orders_accepted_payout_route_mirrors_immutable' then raise; end if;
  end;

  begin
    update public.orders
    set tailor_payout_currency_locked = 'NGN'
    where id::text = v_order_id;
    raise exception 'expected accepted payout currency mirror to be immutable';
  exception when check_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name <> 'orders_accepted_payout_route_mirrors_immutable' then raise; end if;
  end;

  begin
    update public.orders
    set tailor_payout_provider_locked = 'PAYSTACK'
    where id::text = v_order_id;
    raise exception 'expected accepted payout provider mirror to be immutable';
  exception when check_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name <> 'orders_accepted_payout_route_mirrors_immutable' then raise; end if;
  end;

  begin
    update public.orders
    set tailor_stripe_connect_account_id_locked = 'acct_phase2_qa_replacement'
    where id::text = v_order_id;
    raise exception 'expected accepted Stripe destination mirror to be immutable';
  exception when check_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name <> 'orders_accepted_payout_route_mirrors_immutable' then raise; end if;
  end;

  begin
    update public.orders
    set tailor_paystack_recipient_code_locked = 'phase2-qa-replacement-recipient'
    where id::text = v_order_id;
    raise exception 'expected accepted Paystack destination mirror to be immutable';
  exception when check_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name <> 'orders_accepted_payout_route_mirrors_immutable' then raise; end if;
  end;

  raise notice 'PASS: route snapshot and quote acceptance committed atomically';
end;
$test$;

rollback;
