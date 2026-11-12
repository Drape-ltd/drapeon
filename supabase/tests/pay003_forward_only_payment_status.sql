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

  begin
    update pay003_payment_probe set refunded_amount = 0 where id = v_id;
    raise exception 'zero partial refund was accepted';
  exception when others then
    if sqlerrm <> 'PARTIAL_REFUND_REQUIRES_PARTIAL_AMOUNT' then raise; end if;
  end;

  begin
    update pay003_payment_probe set refunded_amount = 1000 where id = v_id;
    raise exception 'full amount with PARTIAL_REFUND was accepted';
  exception when others then
    if sqlerrm <> 'PARTIAL_REFUND_REQUIRES_PARTIAL_AMOUNT' then raise; end if;
  end;

  begin
    update pay003_payment_probe set refunded_amount = 1001 where id = v_id;
    raise exception 'refund greater than payment was accepted';
  exception when others then
    if sqlerrm <> 'PAYMENT_REFUNDED_AMOUNT_OUT_OF_RANGE' then raise; end if;
  end;
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
  payment_id, provider, provider_refund_id, amount, status, provider_response
) values
  ('73000000-0000-4000-8000-000000000005', 'STRIPE', 're_pay003_one', 300, 'CONFIRMED', '{"status":"succeeded"}'),
  ('73000000-0000-4000-8000-000000000005', 'STRIPE', 're_pay003_two', 200, 'CONFIRMED', '{"status":"succeeded"}');

do $test$
declare
  v_payment public.order_payments%rowtype;
begin
  perform public.reconcile_failed_order_payment_refund(
    '73000000-0000-4000-8000-000000000005', 're_pay003_one',
    '{"failure_reason":"provider confirmed terminal failure","event_id":"evt_pay003_one"}'::jsonb
  );
  select * into v_payment from public.order_payments
  where id = '73000000-0000-4000-8000-000000000005';
  if v_payment.status::text <> 'PARTIAL_REFUND'
     or v_payment.refunded_amount <> 200
     or v_payment.partial_refund_count <> 1 then
    raise exception 'non-latest failed refund was not recomputed atomically: %', row_to_json(v_payment);
  end if;

  perform public.reconcile_failed_order_payment_refund(
    '73000000-0000-4000-8000-000000000005', 're_pay003_two',
    '{"failure_reason":"provider confirmed terminal failure","event_id":"evt_pay003_two"}'::jsonb
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

-- A FAILED attempt with a newer attempt is superseded even when older code did
-- not persist the JSON marker. Its captured late success must be refundable.
insert into public.order_payments (
  id, order_id, phase, provider, currency, amount, status, idempotency_key,
  provider_payment_id, created_at
) values
  ('73000000-0000-4000-8000-000000000010',
   '73000000-0000-4000-8000-000000000004', 'FULFILLMENT', 'STRIPE', 'USD',
   1000, 'FAILED', 'pay003-old-failed', 'pi_pay003_old_failed', now() - interval '1 minute'),
  ('73000000-0000-4000-8000-000000000011',
   '73000000-0000-4000-8000-000000000004', 'FULFILLMENT', 'STRIPE', 'USD',
   1000, 'PENDING', 'pay003-newer-pending', 'pi_pay003_newer_pending', now());

do $test$
declare
  v_operation jsonb;
begin
  v_operation := public.reserve_payment_late_success_refund(
    '73000000-0000-4000-8000-000000000010', 'evt_pay003_newer_attempt'
  );
  if v_operation->>'payment_id' <> '73000000-0000-4000-8000-000000000010'
     or v_operation->>'status' <> 'RESERVED' then
    raise exception 'newer-attempt late success was not reserved for auto-refund: %', v_operation;
  end if;
  raise notice 'PASS: PAY-003 newer attempt makes an unmarked FAILED attempt auto-refundable';
end;
$test$;

-- A legacy partial refund baseline must participate in the next aggregate.
insert into public.order_payments (
  id, order_id, phase, provider, currency, amount, status, idempotency_key,
  provider_payment_id, confirmed_at, refunded_amount, partial_refund_count
) values (
  '73000000-0000-4000-8000-000000000006',
  '73000000-0000-4000-8000-000000000004',
  'TIP', 'STRIPE', 'USD', 1000, 'PARTIAL_REFUND',
  'pay003-legacy-refund-qa', 'pi_pay003_legacy_refund', now(), 250, 1
);
insert into public.order_payment_provider_refunds (
  payment_id, provider, provider_refund_id, amount, status, provider_response
) values (
  '73000000-0000-4000-8000-000000000006', 'STRIPE',
  'LEGACY-73000000-0000-4000-8000-000000000006', 250, 'CONFIRMED',
  '{"source":"PAY003_LEGACY_BASELINE"}'::jsonb
);

do $test$
declare
  v_payment public.order_payments%rowtype;
begin
  perform public.record_confirmed_order_payment_refund(
    '73000000-0000-4000-8000-000000000006', 're_pay003_after_legacy', 300,
    '{"status":"succeeded"}'::jsonb
  );
  select * into v_payment from public.order_payments
  where id = '73000000-0000-4000-8000-000000000006';
  if v_payment.status::text <> 'PARTIAL_REFUND'
     or v_payment.refunded_amount <> 550
     or v_payment.partial_refund_count <> 2 then
    raise exception 'legacy baseline was omitted from new refund aggregate: %', row_to_json(v_payment);
  end if;
  raise notice 'PASS: PAY-003 legacy baseline contributes to later refunds';
end;
$test$;

-- Bachs success must write the shared provider-refund ledger; a later terminal
-- failure then uses the same aggregate-derived reversal.
insert into public.order_payments (
  id, order_id, phase, provider, currency, amount, status, idempotency_key,
  provider_payment_id, confirmed_at, refunded_amount, partial_refund_count
) values (
  '73000000-0000-4000-8000-000000000007',
  '73000000-0000-4000-8000-000000000004',
  'INITIAL_ORDER', 'BACHS', 'USD', 1000, 'SUCCEEDED',
  'pay003-bachs-refund-qa', 'checkout_pay003_bachs_refund', now(), 0, 0
);
insert into public.order_payment_refund_claims (
  id, payment_id, order_id, phase, provider, currency, charged_amount,
  refunded_before, refund_amount, provider_payment_id, operation_key,
  status, refund_context
) values (
  '73000000-0000-4000-8000-000000000008',
  '73000000-0000-4000-8000-000000000007',
  '73000000-0000-4000-8000-000000000004', 'INITIAL_ORDER', 'BACHS', 'USD',
  1000, 0, 400, 'checkout_pay003_bachs_refund', 'pay003-bachs-claim',
  'RESERVED', '{"provider":"BACHS","ledger_entries":[{"accountCode":"CUSTOMER_REFUND","accountScope":"ORDER","direction":"DEBIT","currency":"USD","amount":"400"},{"accountCode":"PROVIDER_CLEARING","accountScope":"PROVIDER","direction":"CREDIT","currency":"USD","amount":"400"}]}'::jsonb
);
insert into public.order_payment_refund_attempts (
  id, refund_claim_id, attempt_number, provider_reference, idempotency_key,
  provider_charge_id
) values (
  '73000000-0000-4000-8000-000000000009',
  '73000000-0000-4000-8000-000000000008', 1,
  'refund_pay003_bachs', 'pay003-bachs-attempt', 'checkout_pay003_bachs_refund'
);

do $test$
declare
  v_payment public.order_payments%rowtype;
  v_outcome jsonb;
begin
  v_outcome := public.record_bachs_payment_refund_attempt_outcome(
    '73000000-0000-4000-8000-000000000009', 'SUCCEEDED',
    'rf_bachs_pay003', '{"status":"success"}'::jsonb
  );
  select * into v_payment from public.order_payments
  where id = '73000000-0000-4000-8000-000000000007';
  if v_payment.status::text <> 'PARTIAL_REFUND'
     or v_payment.refunded_amount <> 400
     or not exists (
       select 1 from public.order_payment_provider_refunds
       where payment_id = v_payment.id
         and provider_refund_id = 'rf_bachs_pay003'
         and status = 'CONFIRMED' and amount = 400
     ) then
    raise exception 'Bachs success skipped shared refund aggregate: %, %', v_outcome, row_to_json(v_payment);
  end if;

  v_outcome := public.record_bachs_payment_refund_attempt_outcome(
    '73000000-0000-4000-8000-000000000009', 'FAILED_RECONCILED',
    'rf_bachs_pay003', '{"status":"failed"}'::jsonb
  );
  if v_outcome->>'outcome' <> 'TERMINAL_CONFLICT' then
    raise exception 'Bachs terminal failure did not require exact reversal: %', v_outcome;
  end if;
  perform public.reconcile_failed_order_payment_refund(
    v_payment.id, 'rf_bachs_pay003',
    '{"failure_reason":"Bachs terminal failure","event_id":"evt_bachs_pay003"}'::jsonb
  );
  select * into v_payment from public.order_payments
  where id = '73000000-0000-4000-8000-000000000007';
  if v_payment.status::text <> 'SUCCEEDED' or v_payment.refunded_amount <> 0 then
    raise exception 'Bachs failed refund did not recompute shared aggregate: %', row_to_json(v_payment);
  end if;
  raise notice 'PASS: PAY-003 Bachs success and failure use shared refund aggregate';
end;
$test$;

-- The order advancement guard uses the same provider/payment columns for
-- custom and ready-made orders, including Bachs checkout IDs.
insert into public.orders (
  id, reference, customer_id, tailor_profile_id, garment_type, description,
  fabric_source, delivery_method, currency, stage, order_kind
) values
  ('73000000-0000-4000-8000-000000000020', 'PAY003-CUSTOM-STRIPE',
   '73000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000003',
   'Test garment', 'PAY-003 custom Stripe guard', 'CUSTOMER_SUPPLIES', 'SHIPPING', 'USD', 'PAYMENT_PENDING', 'CUSTOM'),
  ('73000000-0000-4000-8000-000000000021', 'PAY003-CUSTOM-BACHS',
   '73000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000003',
   'Test garment', 'PAY-003 custom Bachs guard', 'CUSTOMER_SUPPLIES', 'SHIPPING', 'USD', 'PAYMENT_PENDING', 'CUSTOM'),
  ('73000000-0000-4000-8000-000000000022', 'PAY003-READY-STRIPE',
   '73000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000003',
   'Ready-made test', 'PAY-003 ready-made Stripe guard', 'TAILOR_SOURCES', 'SHIPPING', 'USD', 'PAYMENT_PENDING', 'READY_MADE'),
  ('73000000-0000-4000-8000-000000000023', 'PAY003-READY-BACHS',
   '73000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000003',
   'Ready-made test', 'PAY-003 ready-made Bachs guard', 'TAILOR_SOURCES', 'SHIPPING', 'USD', 'PAYMENT_PENDING', 'READY_MADE'),
  ('73000000-0000-4000-8000-000000000024', 'PAY003-READY-BACHS-REFUNDED',
   '73000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000003',
   'Ready-made test', 'PAY-003 refunded ready-made Bachs guard', 'TAILOR_SOURCES', 'SHIPPING', 'USD', 'PAYMENT_PENDING', 'READY_MADE');

insert into public.order_payments (
  id, order_id, phase, provider, currency, amount, status, idempotency_key,
  provider_payment_id, confirmed_at, refunded_amount, partial_refund_count
) values
  ('73000000-0000-4000-8000-000000000030', '73000000-0000-4000-8000-000000000020',
   'INITIAL_ORDER', 'STRIPE', 'USD', 1000, 'SUCCEEDED', 'pay003-custom-stripe', 'pi_pay003_custom', now(), 0, 0),
  ('73000000-0000-4000-8000-000000000031', '73000000-0000-4000-8000-000000000021',
   'INITIAL_ORDER', 'BACHS', 'USD', 1000, 'SUCCEEDED', 'pay003-custom-bachs', 'checkout_pay003_custom', now(), 0, 0),
  ('73000000-0000-4000-8000-000000000032', '73000000-0000-4000-8000-000000000022',
   'INITIAL_ORDER', 'STRIPE', 'USD', 1000, 'SUCCEEDED', 'pay003-ready-stripe', 'pi_pay003_ready', now(), 0, 0),
  ('73000000-0000-4000-8000-000000000033', '73000000-0000-4000-8000-000000000023',
   'INITIAL_ORDER', 'BACHS', 'USD', 1000, 'SUCCEEDED', 'pay003-ready-bachs', 'checkout_pay003_ready', now(), 0, 0),
  ('73000000-0000-4000-8000-000000000034', '73000000-0000-4000-8000-000000000024',
   'INITIAL_ORDER', 'BACHS', 'USD', 1000, 'REFUNDED', 'pay003-ready-bachs-refunded',
   'checkout_pay003_ready_refunded', now(), 1000, 1);

do $test$
begin
  update public.orders set stage = 'CONFIRMED', payment_provider = 'STRIPE',
    payment_intent_id = 'pi_pay003_custom'
  where id = '73000000-0000-4000-8000-000000000020';
  update public.orders set stage = 'CONFIRMED', payment_provider = 'BACHS',
    payment_intent_id = 'checkout_pay003_custom'
  where id = '73000000-0000-4000-8000-000000000021';
  update public.orders set stage = 'CONFIRMED', payment_provider = 'STRIPE',
    payment_intent_id = 'pi_pay003_ready'
  where id = '73000000-0000-4000-8000-000000000022';
  update public.orders set stage = 'CONFIRMED', payment_provider = 'BACHS',
    payment_intent_id = 'checkout_pay003_ready'
  where id = '73000000-0000-4000-8000-000000000023';

  begin
    update public.orders set stage = 'CONFIRMED', payment_provider = 'BACHS',
      payment_intent_id = 'checkout_pay003_ready_refunded'
    where id = '73000000-0000-4000-8000-000000000024';
    raise exception 'refunded ready-made Bachs payment advanced the order';
  exception when others then
    if sqlerrm <> 'ORDER_ADVANCEMENT_REQUIRES_CURRENT_SUCCEEDED_PAYMENT' then raise; end if;
  end;
  raise notice 'PASS: PAY-003 order guard maps Stripe/Bachs custom and ready-made payments';
end;
$test$;

rollback;
