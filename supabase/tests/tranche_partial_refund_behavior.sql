-- Run against an isolated Postgres database loaded with
-- tranche_partial_refund_isolated_schema.sql and the live function bodies.
-- The reservation assertion fails on main and passes with the forward migration.
begin;

create trigger payout_claim_tranche_source_guard
  before insert on public.payout_claims for each row
  execute function public.guard_tranche_claim_source_identity();
create trigger payout_claim_reserve_staged_work
  after insert on public.payout_claims for each row
  execute function payment_internal.reserve_staged_work_for_payout();
create trigger payout_claim_require_staged_work_before_provider
  before update of status on public.payout_claims for each row
  execute function payment_internal.require_tranche_work_before_provider();
create trigger payout_claim_confirm_order_work
  after update of status,transfer_status,provider_transfer_id on public.payout_claims
  for each row execute function payment_internal.confirm_order_work_payout_from_claim();

insert into public.orders (
  id,id_text,reference,customer_id,tailor_id,tailor_profile_id,garment_type,
  currency,tailor_payout_provider_locked,tailor_payout_currency_locked,
  accepted_route_snapshot_at,charge_provider_snapshot,payment_route_version,
  payment_route_id,payout_destination_id,legal_entity_snapshot
) values (
  '00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000101',
  'SYNTH-TRANCHE','00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000104',
  'Test garment','USD','STRIPE','USD',now(),'STRIPE',1,
  '00000000-0000-4000-8000-000000000105',
  '00000000-0000-4000-8000-000000000106','US'
);
insert into public.tailor_profiles (
  id,id_text,user_id,display_name,payout_account_verified,payout_reverification_required
) values (
  '00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000104',
  '00000000-0000-4000-8000-000000000103','Synthetic tailor',true,false
);
insert into public.payout_destinations (
  id,tailor_profile_id,provider,currency,country_code,legal_entity,fees_collector,
  provider_account_ref,active,transfers_enabled,payouts_enabled,
  first_withdrawal_review_status,capability_checked_at
) values (
  '00000000-0000-4000-8000-000000000106',
  '00000000-0000-4000-8000-000000000104','STRIPE','USD','US','US','DRAPEON',
  'acct_synthetic',true,true,true,'CLEARED',now()
);
insert into public.order_payments (
  id,order_id,idempotency_key,provider,phase,currency,status,amount,
  refunded_amount,ledger_recorded_at
) values (
  '00000000-0000-4000-8000-000000000107',
  '00000000-0000-4000-8000-000000000101','synthetic-payment',
  'STRIPE','INITIAL_ORDER','USD','PARTIAL_REFUND',23274,300,now()
);
insert into public.order_settlement_plans (
  id,order_id,source_payment_id,customer_id,tailor_id,currency,method,status,
  policy_version,entitlement_amount,excluded_fabric_allowance_amount,
  seller_subtotal_amount,material_recovery_offset_amount
) values (
  '00000000-0000-4000-8000-000000000108',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000107',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  'USD','SHIPPED','ACTIVE','synthetic-settlement-v1',12000,8000,20000,0
);
insert into public.order_settlement_tranches (
  id,plan_id,order_id,code,sequence,basis_points,amount,currency,status,
  eligible_at,correlation_id
) values (
  '00000000-0000-4000-8000-000000000109',
  '00000000-0000-4000-8000-000000000108',
  '00000000-0000-4000-8000-000000000101',
  'SHIP_CUSTODY_70',1,7000,8400,'USD','ELIGIBLE',now()-interval '1 minute',
  '00000000-0000-4000-8000-000000000110'
);
insert into public.order_settlement_tranches (
  id,plan_id,order_id,code,sequence,basis_points,amount,currency,status,
  correlation_id
) values
  ('00000000-0000-4000-8000-000000000116',
   '00000000-0000-4000-8000-000000000108',
   '00000000-0000-4000-8000-000000000101',
   'SHIP_DELIVERY_20',2,2000,2400,'USD','LOCKED',
   '00000000-0000-4000-8000-000000000110'),
  ('00000000-0000-4000-8000-000000000117',
   '00000000-0000-4000-8000-000000000108',
   '00000000-0000-4000-8000-000000000101',
   'SHIP_PROTECTION_10',3,1000,1200,'USD','LOCKED',
   '00000000-0000-4000-8000-000000000110');
insert into public.money_desk_requests (
  id,action_type,target_type,target_id,order_id,amount,currency,status,
  approval_count,required_approval_count,idempotency_key,request_hash,
  requester_jit_grant_id,requester_subject,requester_email,requester_role,
  risk_level,reason
) values (
  '00000000-0000-4000-8000-000000000111',
  'PAYOUT_RELEASE','SETTLEMENT_TRANCHE',
  '00000000-0000-4000-8000-000000000109',
  '00000000-0000-4000-8000-000000000101',8400,'USD','EXECUTING',2,2,
  'synthetic-money-request','synthetic-request-hash',
  '00000000-0000-4000-8000-000000000112',
  'synthetic-preparer','synthetic@example.invalid','ADMIN','HIGH',
  'Synthetic rollback test only'
);
insert into public.commercial_ledger_transactions (
  id,idempotency_key,transaction_kind,purpose,order_id,payment_id,
  original_amount,original_currency,settlement_amount,settlement_currency,
  policy_version,pricing_version,correlation_id,request_hash,provider_reference
) values (
  '00000000-0000-4000-8000-000000000113','synthetic-capture','CAPTURE',
  'INITIAL_ORDER','00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000107',23274,'USD',23274,'USD',
  'synthetic-settlement-v1',1,'00000000-0000-4000-8000-000000000110',
  'synthetic-capture-hash','pi_synthetic'
),(
  '00000000-0000-4000-8000-000000000114','synthetic-refund','REFUND',
  'INITIAL_ORDER','00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000107',300,'USD',300,'USD',
  'synthetic-settlement-v1',1,'00000000-0000-4000-8000-000000000110',
  'synthetic-refund-hash','re_synthetic'
);
update public.commercial_ledger_transactions
  set reversal_of_transaction_id='00000000-0000-4000-8000-000000000113'
  where id='00000000-0000-4000-8000-000000000114';
insert into public.commercial_ledger_entries (
  transaction_id,order_id,account_code,account_scope,direction,amount,currency
) values
  ('00000000-0000-4000-8000-000000000114',
   '00000000-0000-4000-8000-000000000101',
   'FULFILLMENT_LIABILITY','00000000-0000-4000-8000-000000000101','DEBIT',300,'USD'),
  ('00000000-0000-4000-8000-000000000114',
   '00000000-0000-4000-8000-000000000101',
   'PROVIDER_CLEARING','provider','CREDIT',300,'USD');
insert into public.order_payment_provider_refunds (
  id,payment_id,provider,provider_refund_id,amount,status
) values (
  '00000000-0000-4000-8000-000000000115',
  '00000000-0000-4000-8000-000000000107','STRIPE','re_synthetic',300,'CONFIRMED'
);
-- A completed refund claim predating staged funding positions must not make
-- an otherwise classified fulfillment refund permanently unreleasable.
insert into public.order_payment_refund_claims (
  id,order_id,payment_id,refund_amount,currency,status,provider_refund_id
) values (
  '00000000-0000-4000-8000-000000000118',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000107',300,'USD','SUCCEEDED','re_synthetic'
);

do $preflight$
declare
  v_result jsonb;
  v_rejected boolean;
  v_error text;
begin
  begin
    update public.order_payments set status='SUCCEEDED',refunded_amount=0
      where id='00000000-0000-4000-8000-000000000107';
    delete from public.order_payment_refund_claims;
    delete from public.order_payment_provider_refunds;
    delete from public.commercial_ledger_entries
      where transaction_id='00000000-0000-4000-8000-000000000114';
    delete from public.commercial_ledger_transactions
      where id='00000000-0000-4000-8000-000000000114';
    v_result:=public.reserve_settlement_tranche_payout_row(
      '00000000-0000-4000-8000-000000000109',
      '00000000-0000-4000-8000-000000000104',
      '00000000-0000-4000-8000-000000000111',
      'STRIPE','acct_synthetic','1','synthetic-terms-v1');
    if v_result->>'outcome'<>'RESERVED' then
      raise exception 'Unrefunded SUCCEEDED source did not reserve';
    end if;
    raise exception 'ROLLBACK_UNREFUNDED_RESERVATION';
  exception when others then
    if sqlerrm<>'ROLLBACK_UNREFUNDED_RESERVATION' then raise; end if;
  end;

  begin
    update public.commercial_ledger_entries set account_code='TAILOR_ENTITLEMENT'
      where transaction_id='00000000-0000-4000-8000-000000000114'
        and direction='DEBIT';
    v_rejected:=false;
    begin
      perform public.reserve_settlement_tranche_payout_row(
        '00000000-0000-4000-8000-000000000109',
        '00000000-0000-4000-8000-000000000104',
        '00000000-0000-4000-8000-000000000111',
        'STRIPE','acct_synthetic','1','synthetic-terms-v1');
    exception when others then
      v_rejected:=true;
      v_error:=sqlerrm;
    end;
    if not v_rejected
      or (to_regprocedure('payment_internal.tranche_source_payment_available(uuid,uuid,uuid)')
        is not null and v_error not like '%unclassified%')
      or exists(select 1 from public.payout_claims) then
      raise exception 'Tailor-funded refund was not blocked before claim';
    end if;
    raise exception 'ROLLBACK_TAILOR_PREFLIGHT';
  exception when others then
    if sqlerrm<>'ROLLBACK_TAILOR_PREFLIGHT' then raise; end if;
  end;

  begin
    delete from public.commercial_ledger_entries
      where transaction_id='00000000-0000-4000-8000-000000000114';
    delete from public.commercial_ledger_transactions
      where id='00000000-0000-4000-8000-000000000114';
    v_rejected:=false;
    begin
      perform public.reserve_settlement_tranche_payout_row(
        '00000000-0000-4000-8000-000000000109',
        '00000000-0000-4000-8000-000000000104',
        '00000000-0000-4000-8000-000000000111',
        'STRIPE','acct_synthetic','1','synthetic-terms-v1');
    exception when others then
      v_rejected:=true;
      v_error:=sqlerrm;
    end;
    if not v_rejected
      or (to_regprocedure('payment_internal.tranche_source_payment_available(uuid,uuid,uuid)')
        is not null and v_error not like '%unclassified%')
      or exists(select 1 from public.payout_claims) then
      raise exception 'Unjournaled refund was not blocked before claim';
    end if;
    raise exception 'ROLLBACK_MISSING_JOURNAL_PREFLIGHT';
  exception when others then
    if sqlerrm<>'ROLLBACK_MISSING_JOURNAL_PREFLIGHT' then raise; end if;
  end;
  raise notice 'PASS: unrefunded allowed; tailor-funded and unjournaled refunds blocked before claim';
end $preflight$;

do $test$
declare v_result jsonb;
begin
  v_result:=public.reserve_settlement_tranche_payout_row(
    '00000000-0000-4000-8000-000000000109',
    '00000000-0000-4000-8000-000000000104',
    '00000000-0000-4000-8000-000000000111',
    'STRIPE','acct_synthetic','1','synthetic-terms-v1');
  if v_result->>'outcome'<>'RESERVED'
    or (select count(*) from public.payout_claims where source_id=
      '00000000-0000-4000-8000-000000000109')<>1
    or (select count(*) from public.order_work_funding_positions where use_kind='PAYOUT')<>1 then
    raise exception 'Safe partial refund did not reserve exactly one funded tranche';
  end if;
  v_result:=public.reserve_settlement_tranche_payout_row(
    '00000000-0000-4000-8000-000000000109',
    '00000000-0000-4000-8000-000000000104',
    '00000000-0000-4000-8000-000000000111',
    'STRIPE','acct_synthetic','1','synthetic-terms-v1');
  if v_result->>'outcome'<>'EXISTING'
    or (select count(*) from public.payout_claims where source_id=
      '00000000-0000-4000-8000-000000000109')<>1
    or (select count(*) from public.payouts where settlement_tranche_id=
      '00000000-0000-4000-8000-000000000109')<>1 then
    raise exception 'Tranche replay created a second claim or payout';
  end if;
  raise notice 'PASS: non-tailor partial refund reserves once and replays idempotently';
end $test$;

do $safety$
declare
  v_payment uuid := '00000000-0000-4000-8000-000000000107';
  v_plan uuid := '00000000-0000-4000-8000-000000000108';
  v_tranche uuid := '00000000-0000-4000-8000-000000000109';
  v_refund_tx uuid := '00000000-0000-4000-8000-000000000114';
  v_claim_id uuid;
  v_rejected boolean;
begin
  if not payment_internal.tranche_source_payment_available(v_payment,v_plan,v_tranche) then
    raise exception 'Accounted fulfillment refund was rejected';
  end if;
  select id into v_claim_id from public.payout_claims
    where source_kind='SETTLEMENT_TRANCHE' and source_id=v_tranche::text;
  begin
    insert into public.order_payment_refund_claims (
      id,order_id,payment_id,refund_amount,currency,status
    ) values (
      '00000000-0000-4000-8000-000000000119',
      '00000000-0000-4000-8000-000000000101',v_payment,100,'USD','RESERVED'
    );
    v_rejected:=false;
    begin
      update public.payout_claims set status='PROVIDER_UNKNOWN' where id=v_claim_id;
    exception when others then v_rejected:=true; end;
    if not v_rejected then
      raise exception 'Unresolved refund crossed the pre-provider gate';
    end if;
    raise exception 'ROLLBACK_PENDING_REFUND_CASE';
  exception when others then
    if sqlerrm<>'ROLLBACK_PENDING_REFUND_CASE' then raise; end if;
  end;
  begin
    update public.payout_claims set status='PROVIDER_UNKNOWN' where id=v_claim_id;
    if (select status from public.payout_claims where id=v_claim_id)<>'PROVIDER_UNKNOWN' then
      raise exception 'Safe source did not pass the pre-provider gate';
    end if;
    raise exception 'ROLLBACK_SAFE_PROVIDER_CASE';
  exception when others then
    if sqlerrm<>'ROLLBACK_SAFE_PROVIDER_CASE' then raise; end if;
  end;

  begin
    update public.order_payments set status='SUCCEEDED',refunded_amount=0 where id=v_payment;
    delete from public.order_payment_provider_refunds where payment_id=v_payment;
    delete from public.commercial_ledger_entries where transaction_id=v_refund_tx;
    delete from public.commercial_ledger_transactions where id=v_refund_tx;
    if not payment_internal.tranche_source_payment_available(v_payment,v_plan,v_tranche) then
      raise exception 'Unrefunded succeeded source was rejected';
    end if;
    raise exception 'ROLLBACK_SUCCEEDED_CASE';
  exception when others then
    if sqlerrm<>'ROLLBACK_SUCCEEDED_CASE' then raise; end if;
  end;

  begin
    update public.commercial_ledger_entries set account_code='TAILOR_ELIGIBLE'
      where transaction_id=v_refund_tx and direction='DEBIT';
    if payment_internal.tranche_source_payment_available(v_payment,v_plan,v_tranche) then
      raise exception 'Tailor-funded refund was accepted';
    end if;
    v_rejected:=false;
    begin
      update public.payout_claims set status='PROVIDER_UNKNOWN' where id=v_claim_id;
    exception when others then
      v_rejected:=true;
    end;
    if not v_rejected then
      raise exception 'Unsafe refund crossed the pre-provider gate';
    end if;
    raise exception 'ROLLBACK_TAILOR_CASE';
  exception when others then
    if sqlerrm<>'ROLLBACK_TAILOR_CASE' then raise; end if;
  end;

  begin
    delete from public.commercial_ledger_entries where transaction_id=v_refund_tx;
    delete from public.commercial_ledger_transactions where id=v_refund_tx;
    if payment_internal.tranche_source_payment_available(v_payment,v_plan,v_tranche) then
      raise exception 'Unjournaled refund was accepted';
    end if;
    raise exception 'ROLLBACK_MISSING_JOURNAL_CASE';
  exception when others then
    if sqlerrm<>'ROLLBACK_MISSING_JOURNAL_CASE' then raise; end if;
  end;

  begin
    update public.order_payments set status='REFUNDED' where id=v_payment;
    if payment_internal.tranche_source_payment_available(v_payment,v_plan,v_tranche) then
      raise exception 'Fully refunded source was accepted';
    end if;
    raise exception 'ROLLBACK_REFUNDED_CASE';
  exception when others then
    if sqlerrm<>'ROLLBACK_REFUNDED_CASE' then raise; end if;
  end;

  begin
    update public.order_payments set amount=20000 where id=v_payment;
    if payment_internal.tranche_source_payment_available(v_payment,v_plan,v_tranche) then
      raise exception 'Uncovered tailor subtotal was accepted';
    end if;
    raise exception 'ROLLBACK_UNCOVERED_CASE';
  exception when others then
    if sqlerrm<>'ROLLBACK_UNCOVERED_CASE' then raise; end if;
  end;
  raise notice 'PASS: no refund, tailor debit, missing journal, full refund, and insufficient cover';
end $safety$;

do $finalize$
declare
  v_claim uuid;
  v_payout text;
  v_result jsonb;
begin
  select id,payout_id into v_claim,v_payout from public.payout_claims
    where source_id='00000000-0000-4000-8000-000000000109';
  update public.payout_claims set status='PROVIDER_UNKNOWN' where id=v_claim;
  update public.payout_provider_operations
    set status='TRANSFERRED',provider_transfer_id='tr_synthetic'
    where claim_id=v_claim;
  update public.payout_claims
    set status='TRANSFERRED',transfer_status='CONFIRMED',
      provider_transfer_id='tr_synthetic' where id=v_claim;
  v_result:=public.finalize_claimed_route_tranche_release(
    v_claim,v_payout,'tr_synthetic');
  if v_result->>'outcome'<>'COMPLETED'
    or v_result->>'review_needed'<>'false'
    or (select status from public.order_settlement_tranches where id=
      '00000000-0000-4000-8000-000000000109')<>'RELEASED'
    or (select count(*) from public.commercial_ledger_entries e
      join public.commercial_ledger_transactions l on l.id=e.transaction_id
      where l.purpose='SETTLEMENT_RELEASE' and e.account_code='TAILOR_RELEASED'
        and e.direction='CREDIT' and e.amount=8400)<>1
    or (select count(*) from public.order_work_funding_positions
      where payout_claim_id=v_claim and status='PAYOUT_CONFIRMED')<>1
    or (select count(*) from public.ops_issues where order_id=
      '00000000-0000-4000-8000-000000000101')<>0 then
    raise exception 'Safe dispatch refund did not finalize cleanly';
  end if;
  v_result:=public.finalize_claimed_route_tranche_release(
    v_claim,v_payout,'tr_synthetic');
  if v_result->>'outcome'<>'EXISTING'
    or (select count(*) from public.commercial_ledger_transactions
      where purpose='SETTLEMENT_RELEASE')<>1 then
    raise exception 'Finalization replay posted a second release';
  end if;
  raise notice 'PASS: confirmed transfer finalizes once with no false refund-review case';
end $finalize$;

rollback;
