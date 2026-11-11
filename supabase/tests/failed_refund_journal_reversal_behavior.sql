begin;

insert into public.order_payments
  (id,order_id,phase,provider,currency,amount,status,refunded_amount,partial_refund_count,ledger_recorded_at)
values
  ('11111111-1111-4111-8111-111111111111','test-order','INITIAL_ORDER','STRIPE','USD',20000,'REFUNDED',20000,1,now());
insert into public.order_payment_provider_refunds
  (id,payment_id,provider,provider_refund_id,amount,status)
values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','STRIPE','re_test_failed',20000,'CONFIRMED');
insert into public.commercial_ledger_transactions
  (id,idempotency_key,transaction_kind,purpose,order_id,payment_id,policy_version,
   pricing_version,correlation_id,original_currency,original_amount,settlement_currency,
   settlement_amount,fx_rate,provider_fee_amount,provider_reference)
values
  ('33333333-3333-4333-8333-333333333333','capture:test','CAPTURE','INITIAL_ORDER',
   'test-order','11111111-1111-4111-8111-111111111111','test',1,
   '55555555-5555-4555-8555-555555555555','USD',20000,'USD',20000,1,0,'pi_test');
insert into public.commercial_ledger_transactions
  (id,idempotency_key,transaction_kind,purpose,order_id,payment_id,
   reversal_of_transaction_id,policy_version,pricing_version,correlation_id,
   original_currency,original_amount,settlement_currency,settlement_amount,fx_rate,
   provider_fee_amount,provider_reference)
values
  ('44444444-4444-4444-8444-444444444444','refund:test','REFUND','INITIAL_ORDER',
   'test-order','11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','test',1,
   '55555555-5555-4555-8555-555555555555','USD',20000,'USD',20000,1,0,'re_test_failed');
insert into public.commercial_ledger_entries
  (id,transaction_id,order_id,account_code,account_scope,direction,amount,currency)
values
  ('66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444',
   'test-order','FULFILLMENT_LIABILITY','test-order','DEBIT',20000,'USD'),
  ('77777777-7777-4777-8777-777777777777','44444444-4444-4444-8444-444444444444',
   'test-order','PROVIDER_CLEARING','provider','CREDIT',20000,'USD');
insert into public.order_settlement_plans
  (id,order_id,source_payment_id,currency,entitlement_amount,seller_subtotal_amount,
   excluded_fabric_allowance_amount,status)
values
  ('88888888-8888-4888-8888-888888888888','test-order',
   '11111111-1111-4111-8111-111111111111','USD',10000,10000,0,'ACTIVE');
insert into public.order_settlement_tranches
  (id,plan_id,order_id,amount,currency,status)
values
  ('99999999-9999-4999-8999-999999999999',
   '88888888-8888-4888-8888-888888888888','test-order',8400,'USD','ELIGIBLE');

select public.reconcile_failed_order_payment_refund(
  '11111111-1111-4111-8111-111111111111','re_test_failed',
  '{"failure_reason":"provider reported failure"}'::jsonb);

do $$
declare v_reversal uuid;
begin
  select id into v_reversal from public.commercial_ledger_transactions
  where transaction_kind='REVERSAL'
    and reversal_of_transaction_id='44444444-4444-4444-8444-444444444444';
  if v_reversal is null then raise exception 'FAILED_REFUND_JOURNAL_NOT_REVERSED'; end if;
  if (select count(*) from public.commercial_ledger_entries
      where transaction_id=v_reversal and account_code='FULFILLMENT_LIABILITY'
        and direction='CREDIT' and amount=20000)<>1
     or (select count(*) from public.commercial_ledger_entries
      where transaction_id=v_reversal and account_code='PROVIDER_CLEARING'
        and direction='DEBIT' and amount=20000)<>1 then
    raise exception 'FAILED_REFUND_REVERSAL_ENTRIES_MISMATCH';
  end if;
  if (select status from public.order_payments
      where id='11111111-1111-4111-8111-111111111111')<>'SUCCEEDED'
    or (select refunded_amount from public.order_payments
      where id='11111111-1111-4111-8111-111111111111')<>0
    or (select status from public.order_payment_provider_refunds
      where id='22222222-2222-4222-8222-222222222222')<>'FAILED' then
    raise exception 'FAILED_REFUND_PROVIDER_POSITION_MISMATCH';
  end if;
  if not payment_internal.tranche_source_payment_available(
      '11111111-1111-4111-8111-111111111111',
      '88888888-8888-4888-8888-888888888888',
      '99999999-9999-4999-8999-999999999999') then
    raise exception 'FAILED_REFUND_STILL_BLOCKS_TRANCHE';
  end if;
  begin
    perform public.reconcile_failed_order_payment_refund(
      '11111111-1111-4111-8111-111111111111','re_test_failed',
      '{"failure_reason":"provider reported failure"}'::jsonb);
    raise exception 'REPLAY_WAS_NOT_REJECTED';
  exception when others then
    if sqlerrm='REPLAY_WAS_NOT_REJECTED' then raise; end if;
  end;
  if (select count(*) from public.commercial_ledger_transactions
      where transaction_kind='REVERSAL'
        and reversal_of_transaction_id='44444444-4444-4444-8444-444444444444')<>1 then
    raise exception 'REPLAY_CREATED_SECOND_REVERSAL';
  end if;
  raise notice 'PASS: failed refund, exact reversal, tranche and replay';
end $$;

rollback;

begin;
insert into public.order_payments
  (id,order_id,phase,provider,currency,amount,status,refunded_amount,partial_refund_count)
values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','provider-mismatch','INITIAL_ORDER','STRIPE','USD',5000,'REFUNDED',5000,1);
insert into public.order_payment_provider_refunds
  (id,payment_id,provider,provider_refund_id,amount,status)
values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','BACHS','re_wrong_provider',5000,'CONFIRMED');
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.reconcile_failed_order_payment_refund(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc','re_wrong_provider',
      '{"failure_reason":"provider reported failure"}'::jsonb);
  exception when others then
    if sqlerrm <> 'CONFIRMED_REFUND_ROW_NOT_FOUND' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'PROVIDER_MISMATCH_DID_NOT_FAIL_CLOSED'; end if;
  if (select status from public.order_payments
      where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')<>'REFUNDED'
    or (select status from public.order_payment_provider_refunds
      where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')<>'CONFIRMED'
    or (select count(*) from public.commercial_ledger_transactions
      where payment_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')<>0 then
    raise exception 'PROVIDER_MISMATCH_CHANGED_MONEY_STATE';
  end if;
  raise notice 'PASS: refund provider mismatch fails without changing money state';
end $$;
rollback;

begin;
insert into public.order_payments
  (id,order_id,phase,provider,currency,amount,status,refunded_amount,partial_refund_count)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','missing-journal','INITIAL_ORDER','STRIPE','USD',5000,'REFUNDED',5000,1);
insert into public.order_payment_provider_refunds
  (id,payment_id,provider,provider_refund_id,amount,status)
values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','STRIPE','re_no_journal',5000,'CONFIRMED');
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.reconcile_failed_order_payment_refund(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','re_no_journal',
      '{"failure_reason":"provider reported failure"}'::jsonb);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'MISSING_JOURNAL_DID_NOT_FAIL_CLOSED'; end if;
  if (select status from public.order_payments
      where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')<>'REFUNDED'
    or (select status from public.order_payment_provider_refunds
      where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')<>'CONFIRMED' then
    raise exception 'MISSING_JOURNAL_CHANGED_PAYMENT_STATE';
  end if;
  raise notice 'PASS: missing journal fails without changing money state';
end $$;
rollback;
