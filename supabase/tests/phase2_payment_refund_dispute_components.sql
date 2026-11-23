-- Rollback-only integration coverage for the Ops payment-risk components view.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1040000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'phase2-risk-customer@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"role":"CUSTOMER","display_name":"Phase 2 Risk QA Customer"}'::jsonb, now(), now()),
  ('a1040000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'phase2-risk-tailor@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"role":"TAILOR","display_name":"Phase 2 Risk QA Tailor"}'::jsonb, now(), now());

insert into public.customer_profiles (user_id, display_name)
values ('a1040000-0000-4000-8000-000000000001', 'Phase 2 Risk QA Customer');

insert into public.tailor_profiles (
  id, user_id, display_name, location, payout_country_code, payout_currency,
  payout_provider, is_test_profile, is_live, is_verified
) values (
  'a1040000-0000-4000-8000-000000000003',
  'a1040000-0000-4000-8000-000000000002',
  'Phase 2 Risk QA Tailor', 'Test-only', 'US', 'USD', 'STRIPE', true, false, false
);

insert into public.orders (
  id, reference, customer_id, tailor_profile_id, garment_type, description,
  fabric_source, delivery_method, currency, stage
) values (
  'a1040000-0000-4000-8000-000000000004',
  'PHASE2-PAYMENT-RISK-QA',
  'a1040000-0000-4000-8000-000000000001',
  'a1040000-0000-4000-8000-000000000003',
  'Test garment', 'Non-production payment-risk component fixture',
  'CUSTOMER_SUPPLIES', 'SHIPPING', 'USD', 'QUOTE_SENT'
);

insert into public.order_payments (
  id, order_id, phase, provider, currency, amount, status, idempotency_key,
  provider_payment_id, confirmed_at, refunded_amount, updated_at
) values (
  'a1040000-0000-4000-8000-000000000005',
  'a1040000-0000-4000-8000-000000000004',
  'INITIAL_ORDER', 'STRIPE', 'USD', 1000, 'PARTIAL_REFUND',
  'phase2-payment-risk-qa:captured', 'pi_phase2_payment_risk_qa',
  now() - interval '2 days', 200, now()
);

insert into public.provider_disputes (
  provider, provider_dispute_id, provider_charge_id, provider_payment_id,
  payment_id, order_id, amount, currency, status, provider_event_id, opened_at,
  evidence_due_at
) values
  ('STRIPE', 'dp_phase2_risk_linked', 'ch_phase2_risk_linked',
   'pi_phase2_payment_risk_qa', 'a1040000-0000-4000-8000-000000000005',
   'a1040000-0000-4000-8000-000000000004', 300, 'USD', 'NEEDS_RESPONSE',
   'evt_phase2_risk_linked', now() - interval '1 day', now() + interval '5 days'),
  ('STRIPE', 'dp_phase2_risk_order_only', 'ch_phase2_risk_order_only',
   null, null, 'a1040000-0000-4000-8000-000000000004', 125, 'USD', 'UNKNOWN',
   'evt_phase2_risk_order_only', now() - interval '3 hours', null);

set local role service_role;

do $test$
declare
  v_component record;
begin
  select * into v_component
  from public.payout_account_payment_risk_components
  where tailor_profile_id = 'a1040000-0000-4000-8000-000000000003'
    and component_type = 'CAPTURED_PAYMENT'
    and observed_provider = 'STRIPE'
    and currency = 'USD'
    and payment_phase = 'INITIAL_ORDER';
  if v_component.captured_payment_count <> 1
    or v_component.captured_gross_minor <> 1000
    or v_component.recorded_refund_minor <> 200
    or v_component.net_after_recorded_refunds_minor <> 800
    or v_component.unsnapshotted_payment_count <> 1
    or v_component.snapshot_mismatch_count <> 0 then
    raise exception 'Captured/refund components did not preserve the actual payment and legacy snapshot status';
  end if;

  select * into v_component
  from public.payout_account_payment_risk_components
  where tailor_profile_id = 'a1040000-0000-4000-8000-000000000003'
    and component_type = 'OPEN_DISPUTE'
    and link_quality = 'PAYMENT_LINKED'
    and payment_phase = 'INITIAL_ORDER';
  if v_component.open_dispute_count <> 1
    or v_component.open_dispute_minor <> 300
    or v_component.disputes_with_evidence_deadline_count <> 1
    or v_component.earliest_evidence_due_at is null then
    raise exception 'Provider dispute with an exact payment link was not measured';
  end if;

  select * into v_component
  from public.payout_account_payment_risk_components
  where tailor_profile_id = 'a1040000-0000-4000-8000-000000000003'
    and component_type = 'OPEN_DISPUTE'
    and link_quality = 'ORDER_ONLY'
    and payment_phase = 'UNRESOLVED';
  if v_component.open_dispute_count <> 1
    or v_component.open_dispute_minor <> 125 then
    raise exception 'Order-only dispute was incorrectly assigned to a payment phase or omitted';
  end if;

  if has_table_privilege('anon', 'public.payout_account_payment_risk_components', 'SELECT')
    or has_table_privilege('authenticated', 'public.payout_account_payment_risk_components', 'SELECT') then
    raise exception 'Payment risk view must not be readable by public API roles';
  end if;
  if not has_table_privilege('service_role', 'public.payout_account_payment_risk_components', 'SELECT') then
    raise exception 'Ops service role must read the payment risk view';
  end if;

  raise notice 'PASS: payment capture, posted refund, linked dispute, unresolved dispute, and view permissions';
end
$test$;

rollback;
