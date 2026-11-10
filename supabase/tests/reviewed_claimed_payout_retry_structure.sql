begin;

insert into public.payout_claims (
  id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
  provider_destination_id,currency,amount,route_version,earning_policy_version,
  provider_idempotency_key
) values (
  '72000000-0000-4000-8000-000000000010',
  'qa:earning:72000000-0000-4000-8000-000000000010','SETTLEMENT_TRANCHE',
  '72000000-0000-4000-8000-000000000012','qa-order','qa-tailor','STRIPE','acct_qa_same_destination',
  'USD',8400,'qa-route','qa-policy','qa:earning:72000000-0000-4000-8000-000000000010'
);
update public.payout_claims set status='FAILED_RECONCILED',
  transfer_status='FAILED_RECONCILED'
  where id='72000000-0000-4000-8000-000000000010';
insert into public.payout_provider_operations (
  id,claim_id,operation_number,provider,provider_destination_id,currency,amount,
  provider_idempotency_key,status,provider_source_transaction_id,
  final_failure_reference,funds_return_reference,funds_return_confirmed_at
) values (
  '72000000-0000-4000-8000-000000000011',
  '72000000-0000-4000-8000-000000000010',1,'STRIPE',
  'acct_qa_same_destination','USD',8400,
  'qa:earning:72000000-0000-4000-8000-000000000010',
  'FAILED_RETURNED','ch_qa_source','req_qa_definite_rejection',
  'NOT_SENT:transfers_not_enabled',now() - interval '11 minutes'
);
insert into public.money_desk_requests(
  id,action_type,target_type,target_id,order_id,amount,currency,status,
  approved_at,required_approval_count,approval_count,requester_subject,action_payload
) values (
  '72000000-0000-4000-8000-000000000020',
  'POST_RELEASE_RECOVERY','PAYOUT_CLAIM_RETRY',
  '72000000-0000-4000-8000-000000000010','qa-order',8400,'USD',
  'EXECUTING',now(),2,2,'qa-preparer',
  '{"claimId":"72000000-0000-4000-8000-000000000010",
    "trancheId":"72000000-0000-4000-8000-000000000012",
    "priorOperationId":"72000000-0000-4000-8000-000000000011",
    "provider":"STRIPE","destinationId":"acct_qa_same_destination",
    "sourceTransaction":"ch_qa_source",
    "finalFailureReference":"req_qa_definite_rejection",
    "fundsReturnReference":"NOT_SENT:transfers_not_enabled"}'::jsonb
);
insert into public.money_desk_decisions(request_id,decision,approver_subject)
values
  ('72000000-0000-4000-8000-000000000020','APPROVE','qa-approver-one'),
  ('72000000-0000-4000-8000-000000000020','APPROVE','qa-approver-two');
insert into public.money_desk_execution_attempts(request_id,status)
values ('72000000-0000-4000-8000-000000000020','PROCESSING');

create function pg_temp.try_reviewed_retry_authorization()
returns text language plpgsql as $test$
begin
  insert into public.payout_claim_retry_authorizations (
    id,claim_id,prior_operation_id,money_desk_request_id,operation_number,
    provider,provider_destination_id,currency,amount,provider_source_transaction_id,
    final_failure_reference,funds_return_reference
  ) values (
    '72000000-0000-4000-8000-000000000022',
    '72000000-0000-4000-8000-000000000010',
    '72000000-0000-4000-8000-000000000011',
    '72000000-0000-4000-8000-000000000020',2,'STRIPE',
    'acct_qa_same_destination','USD',8400,'ch_qa_source',
    'req_qa_definite_rejection','NOT_SENT:transfers_not_enabled'
  );
  return 'ALLOWED';
exception when others then
  return sqlerrm;
end;
$test$;

do $test$
begin
  update public.money_desk_requests set status='PENDING_APPROVAL',
    approved_at=null,approval_count=0
    where id='72000000-0000-4000-8000-000000000020';
  if pg_temp.try_reviewed_retry_authorization()
      not like '%executing two-person Money Desk request%' then
    raise exception 'Unapproved retry was not blocked';
  end if;
  update public.money_desk_requests set status='EXECUTING',
    approved_at=now(),approval_count=2
    where id='72000000-0000-4000-8000-000000000020';

  update public.money_desk_decisions set approver_subject='qa-approver-one'
    where approver_subject='qa-approver-two';
  if pg_temp.try_reviewed_retry_authorization()
      not like '%two distinct non-requester approvers%' then
    raise exception 'Repeated approver was not blocked';
  end if;
  update public.money_desk_decisions set approver_subject='qa-preparer'
    where approver_subject='qa-approver-one' and ctid=(
      select ctid from public.money_desk_decisions limit 1);
  if pg_temp.try_reviewed_retry_authorization()
      not like '%two distinct non-requester approvers%' then
    raise exception 'Preparer approval was not blocked';
  end if;
  update public.money_desk_decisions set approver_subject='qa-approver-two'
    where approver_subject='qa-preparer';

  update public.money_desk_requests set amount=8300
    where id='72000000-0000-4000-8000-000000000020';
  if pg_temp.try_reviewed_retry_authorization()
      not like '%approved order, amount or provider evidence%' then
    raise exception 'Wrong approved amount was not blocked';
  end if;
  update public.money_desk_requests set amount=8400
    where id='72000000-0000-4000-8000-000000000020';

  update public.payout_provider_operations set final_failure_reference=null
    where id='72000000-0000-4000-8000-000000000011';
  if pg_temp.try_reviewed_retry_authorization()
      not like '%definite not-sent rejection%' then
    raise exception 'Missing provider failure evidence was not blocked';
  end if;
  update public.payout_provider_operations
    set final_failure_reference='req_qa_definite_rejection'
    where id='72000000-0000-4000-8000-000000000011';
  update public.payout_claims set source_kind='ORDER_EARNING'
    where id='72000000-0000-4000-8000-000000000010';
  if pg_temp.try_reviewed_retry_authorization()
      not like '%definite not-sent rejection%' then
    raise exception 'Unsupported legacy earning received a reviewed tranche authorization';
  end if;
  update public.payout_claims set source_kind='SETTLEMENT_TRANCHE'
    where id='72000000-0000-4000-8000-000000000010';

  update public.payout_provider_operations set funds_return_confirmed_at=now()
    where id='72000000-0000-4000-8000-000000000011';
  if pg_temp.try_reviewed_retry_authorization()
      not like '%grace period has not elapsed%' then
    raise exception 'Ten-minute retry grace was not enforced';
  end if;
  update public.payout_provider_operations set funds_return_confirmed_at=now() - interval '11 minutes'
    where id='72000000-0000-4000-8000-000000000011';
  if pg_temp.try_reviewed_retry_authorization() <> 'ALLOWED' then
    raise exception 'Retry was not allowed after the ten-minute grace elapsed';
  end if;
  begin
    update public.payout_claim_retry_authorizations
      set amount=8300 where id='72000000-0000-4000-8000-000000000022';
    raise exception 'Reviewed retry authorization was mutable';
  exception when others then
    if sqlerrm not like '%Reviewed claimed-payout retry authorization is immutable%' then
      raise;
    end if;
  end;
  begin
    delete from public.payout_claim_retry_authorizations
      where id='72000000-0000-4000-8000-000000000022';
    raise exception 'Reviewed retry authorization was deletable';
  exception when others then
    if sqlerrm not like '%Reviewed claimed-payout retry authorization is immutable%' then
      raise;
    end if;
  end;
  raise notice 'PASS unapproved, repeated, preparer, amount and missing-evidence rejections';
end;
$test$;

do $test$
begin
  begin
    insert into public.payout_provider_operations (
      claim_id,operation_number,provider,provider_destination_id,currency,amount,
      provider_idempotency_key,status,provider_source_transaction_id,
      money_desk_request_id,reviewed_retry_id
    ) values (
      '72000000-0000-4000-8000-000000000010',2,'STRIPE',
      'acct_qa_wrong_destination','USD',8400,
      'qa:earning:72000000-0000-4000-8000-000000000010:op:2',
      'RESERVED','ch_qa_source',
      '72000000-0000-4000-8000-000000000020',
      '72000000-0000-4000-8000-000000000022'
    );
    raise exception 'Mismatched reviewed retry operation was inserted';
  exception when others then
    if sqlerrm not like '%Reviewed retry is for a different provider operation%' then
      raise;
    end if;
  end;
  raise notice 'PASS reviewed retry operation rejects a different destination';
end;
$test$;
insert into public.payout_provider_operations (
  claim_id,operation_number,provider,provider_destination_id,currency,amount,
  provider_idempotency_key,status,provider_source_transaction_id,
  money_desk_request_id,reviewed_retry_id
) values (
  '72000000-0000-4000-8000-000000000010',2,'STRIPE',
  'acct_qa_same_destination','USD',8400,
  'qa:earning:72000000-0000-4000-8000-000000000010:op:2',
  'RESERVED','ch_qa_source',
  '72000000-0000-4000-8000-000000000020',
  '72000000-0000-4000-8000-000000000022'
);
update public.payout_provider_operations set status='PROVIDER_UNKNOWN'
  where claim_id='72000000-0000-4000-8000-000000000010'
    and operation_number=2;
do $test$
begin
  if (select count(*) from public.payout_attempts
      where claim_id='72000000-0000-4000-8000-000000000010') <> 1 then
    raise exception 'Direct operation start did not prepare one payout attempt';
  end if;
  raise notice 'PASS direct operation start prepares one attempt';
end;
$test$;

do $test$
begin
  begin
    update public.payout_provider_operations
      set reviewed_retry_id=null,
        reviewed_correction_id='72000000-0000-4000-8000-000000000023'
      where claim_id='72000000-0000-4000-8000-000000000010'
        and operation_number=2;
    raise exception 'Operation 2 review identity was rewritable';
  exception when others then
    if sqlerrm not like '%Provider operation identity cannot change%' then
      raise;
    end if;
  end;
  raise notice 'PASS operation 2 review identity is immutable';
end;
$test$;

do $test$
begin
  if (select count(*) from public.payout_provider_operations
      where operation_number=2 and reviewed_retry_id is not null
        and reviewed_correction_id is null) <> 1 then
    raise exception 'Same-destination reviewed operation did not satisfy structure';
  end if;
  if not (select relrowsecurity from pg_class
      where oid='public.payout_claim_retry_authorizations'::regclass) then
    raise exception 'Retry authorization table lacks RLS';
  end if;
  if has_table_privilege('anon','public.payout_claim_retry_authorizations','SELECT')
    or has_table_privilege('authenticated','public.payout_claim_retry_authorizations','SELECT')
    or not has_table_privilege('service_role','public.payout_claim_retry_authorizations','SELECT') then
    raise exception 'Retry authorization grants are incorrect';
  end if;
  raise notice 'PASS structural retry authorization and service-role grants';
end;
$test$;

-- Exercise the supported RPC on a separate definite-not-sent claim. Replaying
-- the same approved request must return operation 2, not reserve operation 3.
insert into public.orders(id,id_text,accepted_route_snapshot_at) values
  ('72000000-0000-4000-8000-000000000036','qa-order-rpc',now());
insert into public.order_payments (
  id,order_id,phase,provider,status,currency,amount,refunded_amount,ledger_recorded_at
) values (
  '72000000-0000-4000-8000-000000000035','qa-order-rpc','INITIAL_ORDER',
  'STRIPE','SUCCEEDED','USD',12000,0,now()
);
insert into public.order_settlement_plans (
  id,order_id,source_payment_id,currency,status,entitlement_amount,
  seller_subtotal_amount,excluded_fabric_allowance_amount
) values (
  '72000000-0000-4000-8000-000000000037','qa-order-rpc',
  '72000000-0000-4000-8000-000000000035','USD','ACTIVE',8400,8400,0
);
insert into public.commercial_ledger_transactions (
  id,payment_id,order_id,transaction_kind,purpose,original_amount,
  settlement_amount,original_currency,settlement_currency
) values (
  '72000000-0000-4000-8000-000000000038',
  '72000000-0000-4000-8000-000000000035','qa-order-rpc',
  'CAPTURE','INITIAL_ORDER',12000,12000,'USD','USD'
);
insert into public.payout_claims (
  id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
  provider_destination_id,currency,amount,route_version,earning_policy_version,
  provider_idempotency_key
) values (
  '72000000-0000-4000-8000-000000000030','qa:earning:retry-rpc',
  'SETTLEMENT_TRANCHE','72000000-0000-4000-8000-000000000034',
  'qa-order-rpc','qa-tailor','STRIPE',
  'acct_qa_same_destination','USD',8400,'qa-route','qa-policy',
  'qa:earning:retry-rpc'
);
update public.payout_claims set payout_id='qa-payout-rpc'
  where id='72000000-0000-4000-8000-000000000030';
insert into public.order_work_funding_positions (
  source_payment_id,payout_claim_id,use_kind,amount,status
) values (
  '72000000-0000-4000-8000-000000000035',
  '72000000-0000-4000-8000-000000000030','PAYOUT',8400,'RESERVED'
);
insert into public.payouts (
  id,order_id,settlement_tranche_id,source_payment_id,payout_purpose,
  provider_destination_id,amount,currency,status,provider_transfer_status,
  bank_settlement_status,failed_at
) values (
  'qa-payout-rpc','qa-order-rpc','72000000-0000-4000-8000-000000000034',
  '72000000-0000-4000-8000-000000000035','SETTLEMENT_TRANCHE',
  'acct_qa_same_destination',8400,'USD','FAILED','FAILED_RECONCILED',
  'FAILED',now()
);
insert into public.order_settlement_tranches (
  id,plan_id,order_id,amount,currency,status,payout_id
) values (
  '72000000-0000-4000-8000-000000000034',
  '72000000-0000-4000-8000-000000000037','qa-order-rpc',8400,'USD',
  'BLOCKED','qa-payout-rpc'
);
update public.payout_claims set status='FAILED_RECONCILED',
  transfer_status='FAILED_RECONCILED'
  where id='72000000-0000-4000-8000-000000000030';
insert into public.payout_provider_operations (
  id,claim_id,operation_number,provider,provider_destination_id,currency,amount,
  provider_idempotency_key,status,provider_source_transaction_id,
  final_failure_reference,funds_return_reference,funds_return_confirmed_at
) values (
  '72000000-0000-4000-8000-000000000031',
  '72000000-0000-4000-8000-000000000030',1,'STRIPE',
  'acct_qa_same_destination','USD',8400,'qa:earning:retry-rpc',
  'FAILED_RETURNED','ch_qa_source','req_qa_definite_rejection',
  'NOT_SENT:transfers_not_enabled',now()
);
insert into public.money_desk_requests (
  id,action_type,target_type,target_id,order_id,amount,currency,status,
  approved_at,required_approval_count,approval_count,requester_subject,action_payload
) values (
  '72000000-0000-4000-8000-000000000032','POST_RELEASE_RECOVERY',
  'PAYOUT_CLAIM_RETRY','72000000-0000-4000-8000-000000000030',
  'qa-order-rpc',8400,'USD','EXECUTING',now(),2,2,'qa-preparer',
  '{"claimId":"72000000-0000-4000-8000-000000000030",
    "trancheId":"72000000-0000-4000-8000-000000000034",
    "priorOperationId":"72000000-0000-4000-8000-000000000031",
    "provider":"STRIPE","destinationId":"acct_qa_same_destination",
    "sourceTransaction":"ch_qa_source",
    "finalFailureReference":"req_qa_definite_rejection",
    "fundsReturnReference":"NOT_SENT:transfers_not_enabled"}'::jsonb
);
insert into public.money_desk_decisions(request_id,decision,approver_subject)
values
  ('72000000-0000-4000-8000-000000000032','APPROVE','qa-approver-one'),
  ('72000000-0000-4000-8000-000000000032','APPROVE','qa-approver-two');
insert into public.money_desk_execution_attempts (
  request_id,status,executor_email,executor_role
) values (
  '72000000-0000-4000-8000-000000000032','PROCESSING',
  'qa-executor@example.invalid','FINANCE'
);
insert into public.money_desk_requests (
  id,action_type,target_type,target_id,order_id,amount,currency,status,
  approved_at,required_approval_count,approval_count,requester_subject,action_payload
) values (
  '72000000-0000-4000-8000-000000000039','POST_RELEASE_RECOVERY',
  'PAYOUT_CLAIM_RETRY','72000000-0000-4000-8000-000000000030',
  'qa-order-rpc',8400,'USD','EXECUTING',now(),2,2,'qa-preparer',
  '{"claimId":"72000000-0000-4000-8000-000000000030",
    "trancheId":"72000000-0000-4000-8000-000000000034"}'::jsonb
);
insert into public.money_desk_execution_attempts (
  request_id,status,executor_email,executor_role
) values (
  '72000000-0000-4000-8000-000000000039','PROCESSING',
  'qa-executor@example.invalid','FINANCE'
);
do $test$
declare
  v_closed jsonb;
  v_replay jsonb;
begin
  v_closed := public.close_unstarted_reviewed_claimed_retry(
    '72000000-0000-4000-8000-000000000039');
  v_replay := public.close_unstarted_reviewed_claimed_retry(
    '72000000-0000-4000-8000-000000000039');
  if v_closed->>'outcome'<>'CLOSED_NO_OPERATION'
    or v_replay->>'outcome'<>'ALREADY_TERMINAL'
    or (select status from public.money_desk_requests
      where id='72000000-0000-4000-8000-000000000039')<>'FAILED'
    or (select status from public.money_desk_execution_attempts
      where request_id='72000000-0000-4000-8000-000000000039')<>'FAILED'
    or (select count(*) from public.money_desk_events
      where request_id='72000000-0000-4000-8000-000000000039'
        and event_type='EXECUTION_FAILED')<>1
    or exists (select 1 from public.payout_provider_operations
      where money_desk_request_id='72000000-0000-4000-8000-000000000039') then
    raise exception 'Unstarted retry did not close exactly once without a provider operation';
  end if;
  if has_function_privilege('anon',
      'public.close_unstarted_reviewed_claimed_retry(uuid)','EXECUTE')
    or has_function_privilege('authenticated',
      'public.close_unstarted_reviewed_claimed_retry(uuid)','EXECUTE')
    or not has_function_privilege('service_role',
      'public.close_unstarted_reviewed_claimed_retry(uuid)','EXECUTE') then
    raise exception 'Unstarted retry close grants are incorrect';
  end if;
  raise notice 'PASS unstarted retry closes once with no provider operation';
end;
$test$;
do $test$
declare
  v_first jsonb;
  v_replay jsonb;
  v_loaded jsonb;
  v_start jsonb;
  v_closed jsonb;
begin
  update public.payouts set source_payment_id=null where id='qa-payout-rpc';
  begin
    perform public.apply_reviewed_claimed_payout_retry(
      '72000000-0000-4000-8000-000000000032',
      'qa-executor@example.invalid','FINANCE');
    raise exception 'Mismatched failed payout was reopened';
  exception when others then
    if sqlerrm not like '%Reviewed retry source payment is missing%' then
      raise;
    end if;
  end;
  update public.payouts set source_payment_id='72000000-0000-4000-8000-000000000035'
    where id='qa-payout-rpc';
  update public.order_settlement_tranches set status='ELIGIBLE'
    where id='72000000-0000-4000-8000-000000000034';
  begin
    perform public.apply_reviewed_claimed_payout_retry(
      '72000000-0000-4000-8000-000000000032',
      'qa-executor@example.invalid','FINANCE');
    raise exception 'Nonblocked tranche was reopened';
  exception when others then
    if sqlerrm not like '%Blocked tranche no longer matches the failed payout%' then
      raise;
    end if;
  end;
  update public.order_settlement_tranches set status='BLOCKED'
    where id='72000000-0000-4000-8000-000000000034';
  insert into public.order_payment_refund_claims(payment_id,status) values
    ('72000000-0000-4000-8000-000000000035','PROVIDER_UNKNOWN');
  begin
    perform public.apply_reviewed_claimed_payout_retry(
      '72000000-0000-4000-8000-000000000032',
      'qa-executor@example.invalid','FINANCE');
    raise exception 'Pending refund raced a reviewed payout retry';
  exception when others then
    if sqlerrm not like '%source is no longer available%' then raise; end if;
  end;
  delete from public.order_payment_refund_claims;
  update public.order_payments set status='PARTIAL_REFUND',refunded_amount=100
    where id='72000000-0000-4000-8000-000000000035';
  begin
    perform public.apply_reviewed_claimed_payout_retry(
      '72000000-0000-4000-8000-000000000032',
      'qa-executor@example.invalid','FINANCE');
    raise exception 'Unjournaled refund raced a reviewed payout retry';
  exception when others then
    if sqlerrm not like '%source is no longer available%' then raise; end if;
  end;
  update public.order_payments set status='SUCCEEDED',refunded_amount=0
    where id='72000000-0000-4000-8000-000000000035';
  insert into public.disputes(order_id,status) values
    ('72000000-0000-4000-8000-000000000036','OPEN');
  begin
    perform public.apply_reviewed_claimed_payout_retry(
      '72000000-0000-4000-8000-000000000032',
      'qa-executor@example.invalid','FINANCE');
    raise exception 'Open dispute raced a reviewed payout retry';
  exception when others then
    if sqlerrm not like '%source is no longer available%' then raise; end if;
  end;
  delete from public.disputes;
  insert into public.provider_disputes(order_id,money_movement_blocked) values
    ('qa-order-rpc',true);
  begin
    perform public.apply_reviewed_claimed_payout_retry(
      '72000000-0000-4000-8000-000000000032',
      'qa-executor@example.invalid','FINANCE');
    raise exception 'Provider dispute raced a reviewed payout retry';
  exception when others then
    if sqlerrm not like '%source is no longer available%' then raise; end if;
  end;
  delete from public.provider_disputes;
  update public.order_settlement_plans set status='FROZEN'
    where id='72000000-0000-4000-8000-000000000037';
  begin
    perform public.apply_reviewed_claimed_payout_retry(
      '72000000-0000-4000-8000-000000000032',
      'qa-executor@example.invalid','FINANCE');
    raise exception 'Frozen plan reopened a reviewed payout retry';
  exception when others then
    if sqlerrm not like '%source is no longer available%' then raise; end if;
  end;
  update public.order_settlement_plans set status='ACTIVE'
    where id='72000000-0000-4000-8000-000000000037';
  update public.order_work_funding_positions set status='PAYOUT_CONFIRMED'
    where payout_claim_id='72000000-0000-4000-8000-000000000030';
  begin
    perform public.apply_reviewed_claimed_payout_retry(
      '72000000-0000-4000-8000-000000000032',
      'qa-executor@example.invalid','FINANCE');
    raise exception 'Consumed funding position was paid again';
  exception when others then
    if sqlerrm not like '%source is no longer available%' then raise; end if;
  end;
  update public.order_work_funding_positions set status='RESERVED'
    where payout_claim_id='72000000-0000-4000-8000-000000000030';
  v_first := public.apply_reviewed_claimed_payout_retry(
    '72000000-0000-4000-8000-000000000032',
    'qa-executor@example.invalid','FINANCE');
  -- A PL/pgSQL exception block is a savepoint: prove the terminal close, then
  -- roll it back so this same fixture can prove the provider-start path below.
  begin
    v_closed := public.close_unstarted_reviewed_claimed_retry(
      '72000000-0000-4000-8000-000000000032');
    if v_closed->>'outcome'<>'CLOSED_NO_OPERATION'
      or (select status from public.payout_claims
        where id='72000000-0000-4000-8000-000000000030')<>'FAILED_RECONCILED'
      or (select status from public.payout_provider_operations
        where id=(v_first->>'operationId')::uuid)<>'FAILED_RETURNED'
      or (select funds_return_reference from public.payout_provider_operations
        where id=(v_first->>'operationId')::uuid)<>'NOT_SENT:LOCAL_PRE_PROVIDER_ABORT'
      or (select status from public.payouts where id='qa-payout-rpc')<>'FAILED'
      or (select status from public.order_settlement_tranches
        where id='72000000-0000-4000-8000-000000000034')<>'BLOCKED'
      or (select status from public.money_desk_requests
        where id='72000000-0000-4000-8000-000000000032')<>'FAILED'
      or (select metadata->>'terminal_outcome' from public.ops_issues
        where dedupe_key='stripe-tranche-reconcile:72000000-0000-4000-8000-000000000034')
        <>'NOT_SENT_LOCAL_ABORT'
      or (select title from public.ops_issues
        where dedupe_key='stripe-tranche-reconcile:72000000-0000-4000-8000-000000000034')
        <>'Reviewed payout retry stopped before Stripe'
      or exists (select 1 from public.payout_attempts
        where claim_operation_id=(v_first->>'operationId')::uuid) then
      raise exception 'Reserved no-attempt operation was not closed without a provider send';
    end if;
    if public.close_unstarted_reviewed_claimed_retry(
      '72000000-0000-4000-8000-000000000032')->>'outcome'<>'ALREADY_TERMINAL' then
      raise exception 'Reserved close replay was not idempotent';
    end if;
    begin
      perform public.apply_reviewed_claimed_payout_retry(
        '72000000-0000-4000-8000-000000000032',
        'qa-executor@example.invalid','FINANCE');
      raise exception 'A closed request reopened its provider operation';
    exception when others then
      if sqlerrm not like '%no longer executing%' then raise; end if;
    end;
    raise exception 'ROLLBACK_CLOSE_TEST';
  exception when raise_exception then
    if sqlerrm<>'ROLLBACK_CLOSE_TEST' then raise; end if;
  end;
  v_replay := public.apply_reviewed_claimed_payout_retry(
    '72000000-0000-4000-8000-000000000032',
    'qa-executor@example.invalid','FINANCE');
  if v_first->>'outcome' <> 'RETRY_READY'
    or v_replay->>'outcome' <> 'EXISTING'
    or v_first->>'operationId' is distinct from v_replay->>'operationId'
    or v_first->>'providerKey' <> 'qa:earning:retry-rpc:op:2'
    or (select count(*) from public.payout_provider_operations
        where claim_id='72000000-0000-4000-8000-000000000030') <> 2
    or (select count(*) from public.payout_claim_retry_authorizations
        where claim_id='72000000-0000-4000-8000-000000000030') <> 1
    or (select status from public.payout_claims
        where id='72000000-0000-4000-8000-000000000030') <> 'RESERVED'
    or (select status from public.payouts where id='qa-payout-rpc') <> 'PROCESSING'
    or (select status from public.order_settlement_tranches
        where id='72000000-0000-4000-8000-000000000034') <> 'RELEASE_REQUESTED'
    or (select money_desk_request_id from public.order_settlement_tranches
        where id='72000000-0000-4000-8000-000000000034') is distinct from
        '72000000-0000-4000-8000-000000000032'::uuid then
    raise exception 'Reviewed retry RPC did not reserve exactly one new operation';
  end if;
  v_loaded := public.load_reviewed_claimed_tranche_retry(
    '72000000-0000-4000-8000-000000000034',
    '72000000-0000-4000-8000-000000000032',
    'STRIPE','acct_qa_same_destination','ch_qa_source');
  if v_loaded->>'outcome'<>'EXISTING'
    or v_loaded->>'claim_id'<>'72000000-0000-4000-8000-000000000030'
    or v_loaded->>'payout_id'<>'qa-payout-rpc'
    or v_loaded->>'provider_idempotency_key'<>'qa:earning:retry-rpc'
    or v_loaded->>'operation_number'<>'2'
    or v_loaded->>'operation_id' is distinct from v_first->>'operationId'
    or v_loaded->>'reviewed_retry_id' is distinct from v_first->>'reviewedRetryId' then
    raise exception 'Reviewed retry loader did not return the exact operation-2 reservation';
  end if;
  if has_function_privilege('anon',
      'public.load_reviewed_claimed_tranche_retry(uuid,uuid,text,text,text)','EXECUTE')
    or has_function_privilege('authenticated',
      'public.load_reviewed_claimed_tranche_retry(uuid,uuid,text,text,text)','EXECUTE')
    or not has_function_privilege('service_role',
      'public.load_reviewed_claimed_tranche_retry(uuid,uuid,text,text,text)','EXECUTE') then
    raise exception 'Reviewed retry loader grants are incorrect';
  end if;
  begin
    perform public.load_reviewed_claimed_tranche_retry(
      '72000000-0000-4000-8000-000000000034',
      '72000000-0000-4000-8000-000000000032',
      'STRIPE','acct_qa_same_destination','ch_wrong_source');
    raise exception 'Reviewed retry loader accepted a different source charge';
  exception when others then
    if sqlerrm not like '%Reviewed tranche retry no longer matches%' then raise; end if;
  end;
  v_start := public.start_payout_attempt(
    '72000000-0000-4000-8000-000000000030','PROVIDER_CALL');
  if v_start->>'action' <> 'PROVIDER_CALL'
    or v_start->>'reviewed_retry_id' is distinct from v_first->>'reviewedRetryId'
    or v_start->>'provider_idempotency_key' <> 'qa:earning:retry-rpc:op:2'
    or (select count(*) from public.payout_attempts
        where claim_id='72000000-0000-4000-8000-000000000030') <> 1 then
    raise exception 'Reviewed retry start did not preserve one attempt and review identity';
  end if;
  if public.close_unstarted_reviewed_claimed_retry(
      '72000000-0000-4000-8000-000000000032')->>'outcome'
      <> 'PROVIDER_OPERATION_POSSIBLE' then
    raise exception 'Provider-started operation was incorrectly closed as not sent';
  end if;
  v_loaded := public.load_reviewed_claimed_tranche_retry(
    '72000000-0000-4000-8000-000000000034',
    '72000000-0000-4000-8000-000000000032',
    'STRIPE','acct_qa_same_destination','ch_qa_source');
  if v_loaded->>'status'<>'PROVIDER_UNKNOWN'
    or v_loaded->>'operation_id' is distinct from v_first->>'operationId'
    or (select count(*) from public.payout_provider_operations
        where claim_id='72000000-0000-4000-8000-000000000030') <> 2 then
    raise exception 'Unknown provider result cannot be reconciled using the same operation';
  end if;
  -- Model the exact durable state after Stripe definitely rejects operation 2.
  -- The provider attempt exists, but no transfer or release journal does.
  update public.payout_provider_operations set
    status='FAILED_RETURNED',
    final_failure_reference='req_qa_retry_rejected',
    funds_return_reference='NOT_SENT:transfers_not_enabled',
    funds_return_confirmed_at=now()
    where id=(v_first->>'operationId')::uuid;
  update public.payout_claims set status='FAILED_RECONCILED',
    transfer_status='FAILED_RECONCILED'
    where id='72000000-0000-4000-8000-000000000030';
  if (select status from public.payouts where id='qa-payout-rpc')<>'PROCESSING'
    or (select status from public.order_settlement_tranches
      where id='72000000-0000-4000-8000-000000000034')<>'RELEASE_REQUESTED' then
    raise exception 'Fixture did not reproduce the pre-close payout and tranche state';
  end if;
  update public.payout_provider_operations set funds_return_reference=null
    where id=(v_first->>'operationId')::uuid;
  if public.close_unstarted_reviewed_claimed_retry(
      '72000000-0000-4000-8000-000000000032')->>'outcome'
      <> 'PROVIDER_OPERATION_POSSIBLE'
    or (select status from public.money_desk_requests
      where id='72000000-0000-4000-8000-000000000032')<>'EXECUTING'
    or (select status from public.payouts where id='qa-payout-rpc')<>'PROCESSING'
    or (select status from public.order_settlement_tranches
      where id='72000000-0000-4000-8000-000000000034')<>'RELEASE_REQUESTED' then
    raise exception 'Retry closed without definite not-sent evidence';
  end if;
  update public.payout_provider_operations set
    funds_return_reference='NOT_SENT:transfers_not_enabled'
    where id=(v_first->>'operationId')::uuid;
  v_closed := public.close_unstarted_reviewed_claimed_retry(
    '72000000-0000-4000-8000-000000000032');
  v_replay := public.close_unstarted_reviewed_claimed_retry(
    '72000000-0000-4000-8000-000000000032');
  if v_closed->>'outcome'<>'CLOSED_DEFINITE_REJECTION'
    or v_replay->>'outcome'<>'ALREADY_TERMINAL'
    or (select status from public.money_desk_requests
      where id='72000000-0000-4000-8000-000000000032')<>'FAILED'
    or (select status from public.money_desk_execution_attempts
      where request_id='72000000-0000-4000-8000-000000000032')<>'FAILED'
    or (select status from public.payouts where id='qa-payout-rpc')<>'FAILED'
    or (select status from public.order_settlement_tranches
      where id='72000000-0000-4000-8000-000000000034')<>'BLOCKED'
    or (select count(*) from public.money_desk_events
      where request_id='72000000-0000-4000-8000-000000000032'
        and event_type='EXECUTION_FAILED')<>1
    or (select count(*) from public.payout_provider_operations
      where claim_id='72000000-0000-4000-8000-000000000030')<>2
    or (select count(*) from public.payout_claim_retry_authorizations
      where claim_id='72000000-0000-4000-8000-000000000030')<>1 then
    raise exception 'Definite operation-2 rejection did not close exactly once';
  end if;
  insert into public.money_desk_requests (
    id,action_type,target_type,target_id,order_id,amount,currency,status,
    approved_at,required_approval_count,approval_count,requester_subject,action_payload
  ) values (
    '72000000-0000-4000-8000-000000000041','POST_RELEASE_RECOVERY',
    'PAYOUT_CLAIM_RETRY','72000000-0000-4000-8000-000000000030',
    'qa-order-rpc',8400,'USD','EXECUTING',now(),2,2,'qa-preparer',
    jsonb_build_object(
      'claimId','72000000-0000-4000-8000-000000000030',
      'trancheId','72000000-0000-4000-8000-000000000034',
      'priorOperationId',v_first->>'operationId',
      'provider','STRIPE','destinationId','acct_qa_same_destination',
      'sourceTransaction','ch_qa_source',
      'finalFailureReference','req_qa_retry_rejected',
      'fundsReturnReference','NOT_SENT:transfers_not_enabled')
  );
  insert into public.money_desk_decisions(request_id,decision,approver_subject)
  values
    ('72000000-0000-4000-8000-000000000041','APPROVE','qa-approver-one'),
    ('72000000-0000-4000-8000-000000000041','APPROVE','qa-approver-two');
  insert into public.money_desk_execution_attempts (
    request_id,status,executor_email,executor_role
  ) values (
    '72000000-0000-4000-8000-000000000041','PROCESSING',
    'qa-executor@example.invalid','FINANCE'
  );
  v_first := public.apply_reviewed_claimed_payout_retry(
    '72000000-0000-4000-8000-000000000041',
    'qa-executor@example.invalid','FINANCE');
  v_replay := public.apply_reviewed_claimed_payout_retry(
    '72000000-0000-4000-8000-000000000041',
    'qa-executor@example.invalid','FINANCE');
  if v_first->>'outcome'<>'RETRY_READY'
    or v_replay->>'outcome'<>'EXISTING'
    or v_first->>'operationId' is distinct from v_replay->>'operationId'
    or v_first->>'providerKey'<>'qa:earning:retry-rpc:op:3'
    or (select count(*) from public.payout_provider_operations
      where claim_id='72000000-0000-4000-8000-000000000030')<>3
    or (select status from public.payouts where id='qa-payout-rpc')<>'PROCESSING'
    or (select status from public.order_settlement_tranches
      where id='72000000-0000-4000-8000-000000000034')<>'RELEASE_REQUESTED' then
    raise exception 'Newly approved operation 3 was not safely reserved once';
  end if;
  raise notice 'PASS reviewed retries reserve operations 2 and 3 once after definite rejections';
end;
$test$;

-- End-to-end recovery after a tranche reservation is closed before any Stripe
-- attempt. The close RPC binds the pinned order charge, and #139 then retries
-- that same payout on the same destination under a new reviewed operation.
insert into public.orders(id,id_text,accepted_route_snapshot_at) values
  ('72000000-0000-4000-8000-000000000100','72000000-0000-4000-8000-000000000100',now());
insert into public.order_payments (
  id,order_id,phase,provider,status,currency,amount,refunded_amount,
  ledger_recorded_at,provider_charge_id,provider_response
) values (
  '72000000-0000-4000-8000-000000000101','72000000-0000-4000-8000-000000000100',
  'INITIAL_ORDER','STRIPE','SUCCEEDED','USD',12000,0,now(),
  null,'{"latest_charge":"ch_qa_original_order_charge"}'::jsonb
);
insert into public.commercial_ledger_transactions (
  id,payment_id,order_id,transaction_kind,purpose,original_amount,
  settlement_amount,original_currency,settlement_currency
) values (
  '72000000-0000-4000-8000-000000000102',
  '72000000-0000-4000-8000-000000000101','72000000-0000-4000-8000-000000000100',
  'CAPTURE','INITIAL_ORDER',12000,12000,'USD','USD'
);
insert into public.order_settlement_plans (
  id,order_id,source_payment_id,currency,status,entitlement_amount,
  seller_subtotal_amount,excluded_fabric_allowance_amount
) values (
  '72000000-0000-4000-8000-000000000103','72000000-0000-4000-8000-000000000100',
  '72000000-0000-4000-8000-000000000101','USD','ACTIVE',8400,8400,0
);
insert into public.order_settlement_tranches (
  id,plan_id,order_id,amount,currency,status,payout_id
) values (
  '72000000-0000-4000-8000-000000000104',
  '72000000-0000-4000-8000-000000000103','72000000-0000-4000-8000-000000000100',
  8400,'USD','RELEASE_REQUESTED','qa-payout-pre-provider'
);
insert into public.payouts (
  id,order_id,settlement_tranche_id,source_payment_id,payout_purpose,
  provider_destination_id,amount,currency,status,provider_transfer_status,
  bank_settlement_status
) values (
  'qa-payout-pre-provider','72000000-0000-4000-8000-000000000100',
  '72000000-0000-4000-8000-000000000104',
  '72000000-0000-4000-8000-000000000101','SETTLEMENT_TRANCHE',
  'acct_qa_pre_provider','8400','USD','PROCESSING','PROCESSING','PENDING'
);
insert into public.payout_claims (
  id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
  provider_destination_id,currency,amount,route_version,earning_policy_version,
  provider_idempotency_key,status,transfer_status,payout_id
) values (
  '72000000-0000-4000-8000-000000000105','qa:earning:pre-provider',
  'SETTLEMENT_TRANCHE','72000000-0000-4000-8000-000000000104',
  '72000000-0000-4000-8000-000000000100','qa-tailor','STRIPE','acct_qa_pre_provider',
  'USD',8400,'qa-route','qa-policy','qa:earning:pre-provider:op:1',
  'RESERVED','NOT_STARTED','qa-payout-pre-provider'
);
insert into public.order_work_funding_positions (
  source_payment_id,payout_claim_id,use_kind,amount,status
) values (
  '72000000-0000-4000-8000-000000000101',
  '72000000-0000-4000-8000-000000000105','PAYOUT',8400,'RESERVED'
);
insert into public.payout_provider_operations (
  id,claim_id,operation_number,provider,provider_destination_id,currency,
  amount,provider_idempotency_key,status
) values (
  '72000000-0000-4000-8000-000000000106',
  '72000000-0000-4000-8000-000000000105',1,'STRIPE',
  'acct_qa_pre_provider','USD',8400,
  'qa:earning:pre-provider:op:1','RESERVED'
);

do $test$
declare
  v_closed jsonb;
  v_retry jsonb;
begin
  v_closed := public.close_unstarted_settlement_tranche_payout(
    '72000000-0000-4000-8000-000000000105','PAYOUT_RELEASE_STRIPE_REFRESH_FAILED',
    'ch_qa_original_order_charge');
  if v_closed->>'outcome'<>'ABORTED'
    or (select provider_source_transaction_id from public.payout_provider_operations
      where id='72000000-0000-4000-8000-000000000106')<>'ch_qa_original_order_charge'
    or (select title from public.ops_issues
      where dedupe_key='stripe-tranche-reconcile:72000000-0000-4000-8000-000000000104')
        <>'Payout stopped before reaching Stripe'
    or (select count(*) from public.ops_issues
      where dedupe_key='stripe-tranche-reconcile:72000000-0000-4000-8000-000000000104')<>1 then
    raise exception 'pre-provider close did not bind source and correct the trigger case';
  end if;
  insert into public.money_desk_requests (
    id,action_type,target_type,target_id,order_id,amount,currency,status,
    approved_at,required_approval_count,approval_count,requester_subject,action_payload
  ) values (
    '72000000-0000-4000-8000-000000000107','POST_RELEASE_RECOVERY',
    'PAYOUT_CLAIM_RETRY','72000000-0000-4000-8000-000000000105',
    '72000000-0000-4000-8000-000000000100',8400,'USD','EXECUTING',now(),2,2,'qa-preparer',
    '{"claimId":"72000000-0000-4000-8000-000000000105",
      "trancheId":"72000000-0000-4000-8000-000000000104",
      "priorOperationId":"72000000-0000-4000-8000-000000000106",
      "provider":"STRIPE","destinationId":"acct_qa_pre_provider",
      "sourceTransaction":"ch_qa_original_order_charge",
      "finalFailureReference":"LOCAL_PRE_PROVIDER_ABORT",
      "fundsReturnReference":"NOT_SENT:LOCAL_PRE_PROVIDER_ABORT"}'::jsonb
  );
  insert into public.money_desk_decisions(request_id,decision,approver_subject)
  values
    ('72000000-0000-4000-8000-000000000107','APPROVE','qa-pre-provider-approver-one'),
    ('72000000-0000-4000-8000-000000000107','APPROVE','qa-pre-provider-approver-two');
  insert into public.money_desk_execution_attempts (
    request_id,status,executor_email,executor_role
  ) values (
    '72000000-0000-4000-8000-000000000107','PROCESSING',
    'qa-executor@example.invalid','FINANCE'
  );
  v_retry := public.apply_reviewed_claimed_payout_retry(
    '72000000-0000-4000-8000-000000000107',
    'qa-executor@example.invalid','FINANCE');
  if v_retry->>'outcome'<>'RETRY_READY'
    or (select provider_source_transaction_id from public.payout_provider_operations
      where id=(v_retry->>'operationId')::uuid)<>'ch_qa_original_order_charge'
    or (select status from public.payout_claims
      where id='72000000-0000-4000-8000-000000000105')<>'RESERVED'
    or (select status from public.payouts
      where id='qa-payout-pre-provider')<>'PROCESSING'
    or (select status from public.order_settlement_tranches
      where id='72000000-0000-4000-8000-000000000104')<>'RELEASE_REQUESTED' then
    raise exception 'reviewed retry did not resume the pre-provider closed tranche: %', v_retry;
  end if;
  raise notice 'PASS pre-provider close binds original charge and reaches reviewed same-destination retry';
end;
$test$;

rollback;
