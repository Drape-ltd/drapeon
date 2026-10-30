-- PAY-003 trigger matrix and refund/identity invariants.
begin;

create temporary table pay003_payment_probe (
  like public.order_payments including defaults including constraints
) on commit drop;

create trigger pay003_payment_probe_guard
before update on pay003_payment_probe
for each row execute function public.guard_order_payment_forward_status();

do $test$
declare
  v_id uuid;
begin
  insert into pay003_payment_probe (
    order_id, phase, provider, currency, amount, status,
    idempotency_key, provider_payment_id
  ) values (
    'pay003-order', 'INITIAL_ORDER', 'STRIPE', 'USD', 1000, 'PENDING',
    'pay003-key', 'pi_pay003'
  ) returning id into v_id;

  update pay003_payment_probe set status = 'SUCCEEDED' where id = v_id;
  update pay003_payment_probe
    set status = 'PARTIAL_REFUND', refunded_amount = 250
    where id = v_id;
  update pay003_payment_probe
    set status = 'PARTIAL_REFUND', refunded_amount = 500
    where id = v_id;
  update pay003_payment_probe
    set status = 'REFUNDED', refunded_amount = 1000
    where id = v_id;

  begin
    update pay003_payment_probe set status = 'SUCCEEDED' where id = v_id;
    raise exception 'REFUNDED -> SUCCEEDED was accepted';
  exception when others then
    if sqlerrm not like 'REFUNDED_PAYMENT_CANNOT_SUCCEED%' then raise; end if;
  end;

  begin
    update pay003_payment_probe set refunded_amount = 900 where id = v_id;
    raise exception 'refunded_amount decrease was accepted';
  exception when others then
    if sqlerrm <> 'PAYMENT_REFUNDED_AMOUNT_CANNOT_DECREASE' then raise; end if;
  end;

  begin
    update pay003_payment_probe set provider_payment_id = 'pi_other' where id = v_id;
    raise exception 'successful payment identity mutation was accepted';
  exception when others then
    if sqlerrm <> 'PAYMENT_IDENTITY_IMMUTABLE_AFTER_SUCCESS' then raise; end if;
  end;

  delete from pay003_payment_probe where id = v_id;
  insert into pay003_payment_probe (
    order_id, phase, provider, currency, amount, status,
    idempotency_key, provider_payment_id
  ) values (
    'pay003-order-2', 'INITIAL_ORDER', 'BACHS', 'USD', 1000, 'FAILED',
    'pay003-key-2', 'checkout_pay003'
  ) returning id into v_id;

  begin
    update pay003_payment_probe set status = 'SUCCEEDED' where id = v_id;
    raise exception 'unevidenced FAILED -> SUCCEEDED was accepted';
  exception when others then
    if sqlerrm not like 'ILLEGAL_PAYMENT_STATUS_TRANSITION:%' then raise; end if;
  end;

  perform set_config('drape.payment_late_success', 'evidenced', true);
  update pay003_payment_probe set status = 'SUCCEEDED' where id = v_id;
  if (select status::text from pay003_payment_probe where id = v_id) <> 'SUCCEEDED' then
    raise exception 'evidenced FAILED -> SUCCEEDED did not apply';
  end if;

  raise notice 'PASS: PAY-003 forward-only trigger matrix and invariants';
end;
$test$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('73000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'pay003-customer@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('73000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'pay003-tailor@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_profiles (user_id, display_name)
values ('73000000-0000-4000-8000-000000000001', 'PAY-003 QA Customer');

insert into public.tailor_profiles (
  id, user_id, display_name, location, payout_country_code, payout_currency,
  payout_provider, is_test_profile, is_live, is_verified
) values (
  '73000000-0000-4000-8000-000000000003',
  '73000000-0000-4000-8000-000000000002',
  'PAY-003 QA Tailor', 'Test-only', 'US', 'USD', 'STRIPE', true, false, false
);

insert into public.orders (
  id, reference, customer_id, tailor_profile_id, garment_type, description,
  fabric_source, delivery_method, currency, stage
) values (
  '73000000-0000-4000-8000-000000000004', 'PAY003-REFUND-FAILURE-QA',
  '73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000003',
  'Test garment', 'Rollback-only PAY-003 refund failure fixture',
  'CUSTOMER_SUPPLIES', 'SHIPPING', 'USD', 'PAYMENT_PENDING'
);

insert into public.order_payments (
  id, order_id, phase, provider, currency, amount, status, idempotency_key,
  provider_payment_id, confirmed_at, refunded_amount, partial_refund_count
) values (
  '73000000-0000-4000-8000-000000000005',
  '73000000-0000-4000-8000-000000000004',
  'INITIAL_ORDER', 'STRIPE', 'USD', 1000, 'PARTIAL_REFUND',
  'pay003-refund-failure-qa', 'pi_pay003_refund_failure', now(), 500, 2
);

insert into public.order_payment_provider_refunds (
  payment_id, provider_refund_id, amount, status, provider_response
) values
  ('73000000-0000-4000-8000-000000000005', 're_pay003_one', 300, 'CONFIRMED', '{"status":"succeeded"}'),
  ('73000000-0000-4000-8000-000000000005', 're_pay003_two', 200, 'CONFIRMED', '{"status":"succeeded"}');

do $test$
declare
  v_payment public.order_payments%rowtype;
begin
  perform public.reconcile_failed_order_payment_refund(
    '73000000-0000-4000-8000-000000000005', 're_pay003_two',
    '{"failure_reason":"provider confirmed terminal failure","event_id":"evt_pay003_two"}'::jsonb
  );
  select * into v_payment from public.order_payments
  where id = '73000000-0000-4000-8000-000000000005';
  if v_payment.status::text <> 'PARTIAL_REFUND'
     or v_payment.refunded_amount <> 300
     or v_payment.partial_refund_count <> 1 then
    raise exception 'one failed partial refund was not removed atomically: %', row_to_json(v_payment);
  end if;

  perform public.reconcile_failed_order_payment_refund(
    '73000000-0000-4000-8000-000000000005', 're_pay003_one',
    '{"failure_reason":"provider confirmed terminal failure","event_id":"evt_pay003_one"}'::jsonb
  );
  select * into v_payment from public.order_payments
  where id = '73000000-0000-4000-8000-000000000005';
  if v_payment.status::text <> 'SUCCEEDED'
     or v_payment.refunded_amount <> 0
     or v_payment.partial_refund_count <> 0 then
    raise exception 'final failed refund did not restore SUCCEEDED/0 atomically: %', row_to_json(v_payment);
  end if;

  begin
    perform public.reconcile_failed_order_payment_refund(
      '73000000-0000-4000-8000-000000000005', 're_pay003_one',
      '{"failure_reason":"duplicate failure event","event_id":"evt_pay003_one"}'::jsonb
    );
    raise exception 'duplicate failure reversal was accepted';
  exception when others then
    if sqlerrm <> 'CONFIRMED_REFUND_ROW_NOT_FOUND' then raise; end if;
  end;

  raise notice 'PASS: PAY-003 failed refund reversal is exact, aggregate-derived, and atomic';
end;
$test$;

rollback;
