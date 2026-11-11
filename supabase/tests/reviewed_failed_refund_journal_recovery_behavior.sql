begin;

insert into public.order_payments
  (id,order_id,phase,provider,currency,amount,status,refunded_amount,provider_payment_id)
values
  ('11111111-1111-4111-8111-111111111111','reviewed-order','INITIAL_ORDER',
   'STRIPE','USD',15500,'SUCCEEDED',0,'pi_reviewed_failed');
insert into public.order_payment_provider_refunds
  (id,payment_id,provider,provider_refund_id,amount,status)
values
  ('22222222-2222-4222-8222-222222222222',
   '11111111-1111-4111-8111-111111111111','STRIPE','re_reviewed_failed',15500,'FAILED');
insert into public.commercial_ledger_transactions
  (id,idempotency_key,transaction_kind,purpose,order_id,payment_id,
   policy_version,pricing_version,correlation_id,original_currency,original_amount,
   settlement_currency,settlement_amount,fx_rate,provider_fee_amount,provider_reference)
values
  ('33333333-3333-4333-8333-333333333333','capture:reviewed','CAPTURE','INITIAL_ORDER',
   'reviewed-order','11111111-1111-4111-8111-111111111111','test',1,
   '99999999-9999-4999-8999-999999999999','USD',15500,'USD',15500,1,0,'pi_reviewed_failed');
insert into public.commercial_ledger_transactions
  (id,idempotency_key,transaction_kind,purpose,order_id,payment_id,
   reversal_of_transaction_id,policy_version,pricing_version,correlation_id,
   original_currency,original_amount,settlement_currency,settlement_amount,fx_rate,
   provider_fee_amount,provider_reference)
values
  ('44444444-4444-4444-8444-444444444444','refund:reviewed','REFUND','INITIAL_ORDER',
   'reviewed-order','11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','test',1,
   '99999999-9999-4999-8999-999999999999','USD',15500,'USD',15500,1,0,'re_reviewed_failed');
insert into public.commercial_ledger_entries
  (id,transaction_id,order_id,account_code,account_scope,direction,amount,currency)
values
  ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444',
   'reviewed-order','FULFILLMENT_LIABILITY','reviewed-order','DEBIT',15500,'USD'),
  ('66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444',
   'reviewed-order','PROVIDER_CLEARING','provider','CREDIT',15500,'USD');
insert into public.money_desk_requests
  (id,action_type,status,target_type,target_id,order_id,amount,currency,
   action_payload,requester_subject,required_approval_count,approval_count,approved_at,
   correlation_id)
values
  ('77777777-7777-4777-8777-777777777777','OTHER_REVIEWED','EXECUTING',
   'FAILED_REFUND_JOURNAL','22222222-2222-4222-8222-222222222222',
   'reviewed-order',15500,'USD',
   '{"providerRefundId":"re_reviewed_failed","paymentId":"11111111-1111-4111-8111-111111111111","opsIssueId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',
   'preparer',2,2,now(),'99999999-9999-4999-8999-999999999999');
insert into public.ops_issues
  (id,order_id,issue_type,status,canonical_status,dedupe_key,sensitivity,correlation_id)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reviewed-order','REFUND_FAILED','OPEN','OPEN',
   'refund-ledger-missing:11111111-1111-4111-8111-111111111111:15500:15500',
   'HIGHLY_RESTRICTED','99999999-9999-4999-8999-999999999999');
insert into public.money_desk_decisions (request_id,decision,approver_subject)
values
  ('77777777-7777-4777-8777-777777777777','APPROVE','reviewer-1'),
  ('77777777-7777-4777-8777-777777777777','APPROVE','reviewer-2');
insert into public.money_desk_execution_attempts
  (id,request_id,status,executor_email,executor_role)
values
  ('88888888-8888-4888-8888-888888888888',
   '77777777-7777-4777-8777-777777777777','PROCESSING','reviewer@example.invalid','FINANCE');

do $$
declare
  v_evidence jsonb := jsonb_build_object(
    'status','failed','refund_id','re_reviewed_failed',
    'payment_intent','pi_reviewed_failed','amount',15500,
    'observed_at',now());
  v_result jsonb;
  v_reversal uuid;
begin
  update public.money_desk_requests set approval_count=1
  where id='77777777-7777-4777-8777-777777777777';
  begin
    perform public.complete_reviewed_failed_refund_journal_recovery(
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',v_evidence);
    raise exception 'ONE_APPROVAL_WAS_ACCEPTED';
  exception when others then
    if sqlerrm <> 'FAILED_REFUND_REVIEW_MISMATCH' then raise; end if;
  end;
  update public.money_desk_requests set approval_count=2
  where id='77777777-7777-4777-8777-777777777777';
  begin
    perform public.complete_reviewed_failed_refund_journal_recovery(
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',
      v_evidence || jsonb_build_object('observed_at',now() - interval '10 minutes'));
    raise exception 'STALE_EVIDENCE_WAS_ACCEPTED';
  exception when others then
    if sqlerrm <> 'FAILED_REFUND_PROVIDER_EVIDENCE_STALE' then raise; end if;
  end;
  -- The reviewed amount and the provider's fresh failed result are mandatory.
  begin
    perform public.complete_reviewed_failed_refund_journal_recovery(
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',
      v_evidence || '{"amount":15499}'::jsonb);
    raise exception 'WRONG_AMOUNT_WAS_ACCEPTED';
  exception when others then
    if sqlerrm <> 'FAILED_REFUND_TARGET_MISMATCH' then raise; end if;
  end;
  if exists (select 1 from public.commercial_ledger_transactions
      where reversal_of_transaction_id='44444444-4444-4444-8444-444444444444'
        and transaction_kind='REVERSAL') then
    raise exception 'FAILED_PREFLIGHT_CHANGED_LEDGER';
  end if;

  v_result := public.complete_reviewed_failed_refund_journal_recovery(
    '77777777-7777-4777-8777-777777777777',
    '88888888-8888-4888-8888-888888888888',v_evidence);
  if v_result->>'ok' <> 'true' or v_result->>'duplicate' <> 'false' then
    raise exception 'REVIEWED_RECOVERY_RESULT_INVALID';
  end if;
  select id into v_reversal from public.commercial_ledger_transactions
  where reversal_of_transaction_id='44444444-4444-4444-8444-444444444444'
    and transaction_kind='REVERSAL';
  if v_reversal is null
     or (select count(*) from public.commercial_ledger_entries
       where transaction_id=v_reversal and account_code='FULFILLMENT_LIABILITY'
         and direction='CREDIT' and amount=15500) <> 1
     or (select count(*) from public.commercial_ledger_entries
       where transaction_id=v_reversal and account_code='PROVIDER_CLEARING'
         and direction='DEBIT' and amount=15500) <> 1
     or (select status from public.money_desk_requests
       where id='77777777-7777-4777-8777-777777777777') <> 'SUCCEEDED'
     or (select status from public.money_desk_execution_attempts
       where id='88888888-8888-4888-8888-888888888888') <> 'SUCCEEDED'
     or (select status from public.ops_issues
       where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'RESOLVED'
     or (select count(*) from public.ops_case_events
       where issue_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
         and event_type='STATE_TRANSITION') <> 1 then
    raise exception 'REVIEWED_RECOVERY_DID_NOT_CLOSE_ATOMICALLY';
  end if;
  v_result := public.complete_reviewed_failed_refund_journal_recovery(
    '77777777-7777-4777-8777-777777777777',
    '88888888-8888-4888-8888-888888888888',v_evidence);
  if v_result->>'duplicate' <> 'true'
     or (select count(*) from public.commercial_ledger_transactions
       where reversal_of_transaction_id='44444444-4444-4444-8444-444444444444') <> 1
     or (select count(*) from public.ops_case_events
       where issue_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1 then
    raise exception 'REPLAY_POSTED_SECOND_REVERSAL';
  end if;
  raise notice 'PASS: reviewed recovery posts one exact reversal and replays safely';
end $$;

rollback;
