-- Run after the migration. This fixture creates its own parties, order, payment,
-- provider refund and journal, then rolls every row back.
begin;
do $$
declare
  v_customer uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_tailor uuid := gen_random_uuid();
  v_profile uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_payment uuid := gen_random_uuid();
  v_refund uuid := gen_random_uuid();
  v_provider_ref text := 're_fixture_' || replace(gen_random_uuid()::text, '-', '');
  v_receipt record;
begin
  insert into auth.users (id, email) values
    (v_customer, 'refund-customer-' || v_customer || '@example.invalid'),
    (v_other, 'refund-other-' || v_other || '@example.invalid'),
    (v_tailor, 'refund-tailor-' || v_tailor || '@example.invalid');
  -- The Auth trigger creates the matching public users.
  update public.users set role = 'TAILOR' where id = v_tailor;
  insert into public.customer_profiles (user_id) values (v_customer);
  insert into public.tailor_profiles (id, user_id, display_name)
    values (v_profile, v_tailor, 'Receipt fixture tailor');
  insert into public.orders (id, reference, customer_id, tailor_id, tailor_profile_id, garment_type, description, fabric_source, delivery_method)
    values (v_order, 'REFUND-FIXTURE-' || v_order::text, v_customer, v_tailor, v_profile,
      'Shirt', 'Receipt isolation fixture', 'CUSTOMER_SUPPLIES', 'LOCAL_COLLECTION');
  insert into public.order_payments (id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id)
    values (v_payment, v_order, 'INITIAL_ORDER', 'STRIPE', 'USD', 300, 'INITIATED',
      'receipt-fixture:' || v_payment::text, 'pi_fixture_' || v_payment::text);
  insert into public.order_payment_provider_refunds (id, payment_id, provider, provider_refund_id, amount, status)
    values (v_refund, v_payment, 'STRIPE', v_provider_ref, 300, 'CONFIRMED');
  insert into public.commercial_ledger_transactions (
    idempotency_key, request_hash, transaction_kind, purpose, order_id, payment_id,
    policy_version, correlation_id, original_currency, original_amount,
    settlement_currency, settlement_amount, provider_reference
  ) values (
    'receipt-fixture-ledger:' || v_refund::text, 'receipt-fixture', 'REFUND', 'INITIAL_ORDER',
    v_order::text, v_payment, 'receipt-fixture', gen_random_uuid(), 'USD', 300,
    'USD', 300, v_provider_ref
  );

  perform set_config('request.jwt.claim.sub', v_customer::text, true);
  select * into v_receipt from public.list_customer_order_refund_receipts(v_order::text);
  if v_receipt.refund_reference <> 'DRF-' || upper(replace(v_refund::text, '-', ''))
     or v_receipt.amount_minor <> 300 or v_receipt.refund_status <> 'COMPLETED' then
    raise exception 'Customer receipt did not match the fixture refund and journal';
  end if;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  if exists (select 1 from public.list_customer_order_refund_receipts(v_order::text)) then
    raise exception 'Refund receipt visible to another user';
  end if;
  if has_function_privilege('anon', 'public.list_customer_order_refund_receipts(text)', 'EXECUTE') then
    raise exception 'Anonymous execute grant exists';
  end if;
  raise notice 'PASS synthetic customer receipt and isolation';
end $$;
rollback;
