insert into public.orders(id,id_text,tailor_profile_id)
values ('qa-order','qa-order','qa-tailor');
insert into public.order_payments(
  id,order_id,provider,currency,phase,status,amount,refunded_amount,ledger_recorded_at
) values (
  '81000000-0000-4000-8000-000000000010','qa-order','STRIPE','USD',
  'INITIAL_ORDER','SUCCEEDED',13531,0,now()
);
insert into public.order_settlement_plans(
  id,order_id,source_payment_id,currency,status,entitlement_amount,
  seller_subtotal_amount,excluded_fabric_allowance_amount
) values (
  '81000000-0000-4000-8000-000000000020','qa-order',
  '81000000-0000-4000-8000-000000000010','USD','ACTIVE',12000,12500,0
);
insert into public.order_settlement_tranches(
  id,plan_id,order_id,amount,currency,status,payout_id
) values (
  '81000000-0000-4000-8000-000000000030',
  '81000000-0000-4000-8000-000000000020','qa-order',8400,'USD',
  'BLOCKED','qa-payout'
);
insert into public.payouts(
  id,order_id,tailor_profile_id,source_payment_id,provider,currency,
  amount,status,payout_purpose,settlement_tranche_id
) values (
  'qa-payout','qa-order','qa-tailor',
  '81000000-0000-4000-8000-000000000010','STRIPE','USD',8400,
  'FAILED','SETTLEMENT_TRANCHE','81000000-0000-4000-8000-000000000030'
);
insert into public.payout_claims(
  id,source_kind,source_id,order_id,tailor_profile_id,payout_id,
  provider,currency,amount,status,transfer_status
) values (
  '81000000-0000-4000-8000-000000000040','SETTLEMENT_TRANCHE',
  '81000000-0000-4000-8000-000000000030','qa-order','qa-tailor',
  'qa-payout','STRIPE','USD',8400,'FAILED_RECONCILED','FAILED_RECONCILED'
);
insert into public.order_work_funding_positions(
  id,payout_claim_id,use_kind,source_payment_id,amount,status
) values (
  '81000000-0000-4000-8000-000000000050',
  '81000000-0000-4000-8000-000000000040','PAYOUT',
  '81000000-0000-4000-8000-000000000010',8400,'RESERVED'
);
insert into public.commercial_ledger_transactions(
  id,payment_id,order_id,transaction_kind,purpose,original_amount,
  settlement_amount,original_currency,settlement_currency
) values (
  '81000000-0000-4000-8000-000000000060',
  '81000000-0000-4000-8000-000000000010','qa-order','CAPTURE',
  'INITIAL_ORDER',13531,13531,'USD','USD'
);

create function public.try_correction(p_number integer)
returns text language plpgsql as $test$
begin
  insert into public.payout_provider_operations(id,claim_id,operation_number)
  values (gen_random_uuid(),'81000000-0000-4000-8000-000000000040',p_number);
  return 'ALLOWED';
exception when others then return sqlerrm;
end;
$test$;

insert into public.order_payments(
  id,order_id,provider,currency,phase,status,amount,refunded_amount,ledger_recorded_at
) values (
  '81000000-0000-4000-8000-000000000090','qa-order','STRIPE','USD',
  'INITIAL_ORDER','SUCCEEDED',8400,0,now()
);
insert into public.payouts(
  id,order_id,tailor_profile_id,source_payment_id,provider,currency,
  amount,status,payout_purpose
) values (
  'qa-order-earning-payout','qa-order','qa-tailor',
  '81000000-0000-4000-8000-000000000090','STRIPE','USD',8400,
  'FAILED','ORDER_EARNING'
);
insert into public.payout_claims(
  id,source_kind,source_id,order_id,tailor_profile_id,payout_id,
  provider,currency,amount,status,transfer_status
) values (
  '81000000-0000-4000-8000-000000000091','ORDER_EARNING',
  'qa-order-earning','qa-order','qa-tailor','qa-order-earning-payout',
  'STRIPE','USD',8400,'BLOCKED','FAILED_RECONCILED'
);
create function public.try_order_earning(p_number integer)
returns text language plpgsql as $test$
begin
  insert into public.payout_provider_operations(id,claim_id,operation_number)
  values (gen_random_uuid(),'81000000-0000-4000-8000-000000000091',p_number);
  return 'ALLOWED';
exception when others then return sqlerrm;
end;
$test$;
