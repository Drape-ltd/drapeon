-- Transaction-scoped snapshot RPC integration test. All fixture writes are rolled back.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'phase2-ready-customer@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"role":"CUSTOMER","display_name":"Phase 2 QA Customer"}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'phase2-ready-tailor@example.invalid', '', now(),
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
  'PHASE2-READY-MADE-ROUTE-QA',
  '00000000-0000-4000-8000-000000000001',
  '361e569f-2eea-4189-85ee-7f115059e046',
  'Test garment', 'Non-production ready-made route fixture',
  'CUSTOMER_SUPPLIES', 'SHIPPING', 'USD', 'PENDING_QUOTE'
);
insert into public.ops_workforce_principals (
  id, email, status, roles, permitted_environments, access_review_due_at, created_by
) values (
  'aebd7ede-6620-48f5-b1e5-f96b49392dfe', 'phase2-ready-admin@example.invalid',
  'ACTIVE', array['admin']::text[], array['development']::text[], now() + interval '1 day', 'rollback-test'
);

select set_config('app.payment_route_actor_id', '00000000-0000-4000-8000-000000000001', true);
select set_config('app.payment_route_actor_principal_id', 'aebd7ede-6620-48f5-b1e5-f96b49392dfe', true);
select set_config('app.payment_route_change_reason', 'Phase 2 ready-made route snapshot integration test', true);

do $test$
declare
  v_customer_id uuid := '00000000-0000-4000-8000-000000000001';
  v_profile_id uuid := '361e569f-2eea-4189-85ee-7f115059e046';
  v_order_id text := '345fe9b0-8b5a-400c-87ed-21b1956b178b';
  v_route_id uuid := gen_random_uuid();
  v_delivery_rule_id uuid := gen_random_uuid();
  v_destination_id uuid := gen_random_uuid();
  v_result jsonb;
  v_order public.orders%rowtype;
begin
  update public.tailor_profiles
  set payout_country_code = 'US', payout_currency = 'USD', payout_provider = 'STRIPE'
  where id = v_profile_id;

  update public.orders
  set stage = 'PENDING_QUOTE', order_kind = 'READY_MADE', currency = 'USD',
      quoted_currency = 'USD', payment_provider = null,
      tailor_payout_provider_locked = 'STRIPE', tailor_payout_currency_locked = 'USD',
      delivery_method = 'SHIPPING', delivery_country_code = 'US',
      subtotal_amount = 12500, item_subtotal = 12500, total_amount = 14500,
      tax_amount = 800, shipping_amount = 1200, accepted_route_snapshot_at = null,
      payment_route_id = null, payment_route_version = null,
      legal_entity_snapshot = null, charge_provider_snapshot = null,
      charge_currency_snapshot = null, payout_destination_id = null,
      fee_schedule_version_snapshot = null, delivery_country_rule_id = null,
      delivery_country_rule_version = null, tax_duty_snapshot = null,
      accepted_earning_amount = null, tailor_terms_version_snapshot = null
  where id::text = v_order_id;

  insert into public.payment_routes (
    id, route_key, version, tailor_country_code, charge_currency, payout_currency,
    provider, legal_entity, status, fees_collector, fee_schedule_version, created_by
  ) values (
    v_route_id, 'test-ready-made-usd-us-stripe', 1, 'US', 'USD', 'USD', 'STRIPE',
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
    'acct_phase2_ready_made_snapshot_test', true, true, 'PLATFORM', 'CLEARED', true, now()
  );

  v_result := public.snapshot_ready_made_payment_route(
    v_order_id, v_customer_id, v_route_id, 1,
    v_delivery_rule_id, 1, v_destination_id, 'US',
    'terms-of-service-2026-06-05'
  );

  select * into v_order from public.orders where id::text = v_order_id;
  if v_order.accepted_route_snapshot_at is null
    or v_order.stage::text <> 'PAYMENT_PENDING'
    or v_order.payment_route_id <> v_route_id
    or v_order.payout_destination_id <> v_destination_id
    or v_order.delivery_country_rule_id <> v_delivery_rule_id
    or v_order.legal_entity_snapshot <> 'O4_GROUP_LLC'
    or v_order.charge_provider_snapshot <> 'STRIPE'
    or v_order.charge_currency_snapshot <> 'USD'
    or v_order.payment_provider::text <> 'STRIPE'
    or v_order.accepted_earning_amount <> 12500
    or v_order.commercial_policy_version <> 'commercial-2026-07-31-v1'
    or v_order.tailor_terms_version_snapshot <> 'terms-of-service-2026-06-05'
    or v_result->>'acceptedEarningAmount' <> '12500' then
    raise exception 'ready-made checkout did not persist the expected route snapshot';
  end if;

  begin
    update public.orders set charge_provider_snapshot = 'BACHS' where id::text = v_order_id;
    raise exception 'expected accepted route snapshot to be immutable';
  exception when check_violation then
    null;
  end;

  raise notice 'PASS: ready-made checkout route snapshot is complete and immutable';
end;
$test$;

rollback;
