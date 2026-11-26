-- Rollback-only Dev integration proof using existing QA identities and a fresh
-- synthetic order. It does not create a provider checkout or enabled route.
begin;
do $guard$
begin
  if not exists (select 1 from public.ops_runtime_configuration
    where singleton and environment='DEVELOPMENT'
      and project_ref='pqptfuqogvrajozfsqzi') then
    raise exception 'PHASE4_DEV_TEST_PROJECT_GUARD';
  end if;
end $guard$;

insert into public.orders
  (id,reference,customer_id,tailor_id,tailor_profile_id,garment_type,
   description,fabric_source,delivery_method,delivery_country_code,currency,
   stage,order_kind,tailor_payout_provider_locked,
   tailor_payout_currency_locked,commercial_policy_version,subtotal_amount,
   tax_amount,platform_fee_amount,shipping_amount,total_amount)
select 'f4260000-0000-4000-8000-000000000001',
  'PHASE4-PROOF-DEV-20261126',customer_id,tailor_id,tailor_profile_id,
  'Dev proof garment','Synthetic Phase 4 Bachs proof order',
  'CUSTOMER_SUPPLIES','LOCAL_COLLECTION','NG','NGN','QUOTE_SENT','CUSTOM',
  'BACHS','NGN',commercial_policy_version,100000,0,0,0,100000
from public.orders where id::text='f4180000-0000-4000-8000-000000000001';

insert into public.order_quotes
  (id,order_id,version,status,change_kind,currency,subtotal_amount,
   tax_amount,platform_fee_amount,delivery_fee_amount,total_amount,
   completion_date,created_by,created_by_role)
select 'f4260000-0000-4000-8000-000000000002',
  'f4260000-0000-4000-8000-000000000001',1,'ACTIVE','INITIAL','NGN',
  100000,0,0,0,100000,now()+interval '14 days',tailor_id::uuid,'TAILOR'
from public.orders
where id::text='f4260000-0000-4000-8000-000000000001';
update public.orders
set active_quote_id='f4260000-0000-4000-8000-000000000002',
    active_quote_version=1
where id::text='f4260000-0000-4000-8000-000000000001';

do $test$
declare v_order public.orders%rowtype; v_route public.payment_routes%rowtype;
  v_delivery public.delivery_country_rules%rowtype;
  v_destination public.payout_destinations%rowtype;
  v_proof uuid; v_result jsonb;
begin
  select * into v_order from public.orders
    where id::text='f4260000-0000-4000-8000-000000000001';
  select * into v_route from public.payment_routes
    where provider='BACHS' and status='DISABLED' and charge_currency='NGN'
    order by version desc limit 1;
  select * into v_delivery from public.delivery_country_rules
    where country_code='NG' and status='READY'
    order by version desc limit 1;
  select * into v_destination from public.payout_destinations
    where tailor_profile_id::text=v_order.tailor_profile_id::text
      and provider='BACHS' and active=true and transfers_enabled=true
      and payouts_enabled=true and first_withdrawal_review_status='CLEARED'
    limit 1;
  if v_order.id is null or v_route.id is null or v_delivery.id is null or
     v_destination.id is null or
     exists(select 1 from public.payment_routes where status='ENABLED') then
    raise exception 'PHASE4_PROOF_ACCEPTANCE_FIXTURE_NOT_READY';
  end if;
  v_proof:=public.open_phase4_payment_proof(
    v_order.customer_id::text,v_order.tailor_profile_id::text,
    v_order.id::text,102000,v_route.id,v_route.version,
    now()+interval '10 minutes','DEV_ROLLBACK_TEST');
  v_result:=public.accept_phase4_payment_proof(
    v_proof,v_delivery.id,v_delivery.version,v_destination.id,'NG',
    'terms-of-service-2026-06-05');
  if (v_result->>'totalAmount')::integer<>102000 or
     (select stage::text from public.orders where id=v_order.id)<>'PAYMENT_PENDING' or
     (select state from public.phase4_payment_proofs where id=v_proof)<>'SNAPSHOTTED' then
    raise exception 'PHASE4_PROOF_ACCEPTANCE_NOT_AT_EXACT_TOTAL';
  end if;
  perform public.authorize_phase4_proof_checkout(
    v_proof,v_order.id::text,102000,'NGN','INITIAL_ORDER','NGN_CARD');
  if (select state from public.phase4_payment_proofs where id=v_proof)<>'CHECKOUT_RESERVED' or
     (select status from public.payment_routes where id=v_route.id)<>'DISABLED' then
    raise exception 'PHASE4_PROOF_AUTHORIZATION_CHANGED_ROUTE';
  end if;
end $test$;
rollback;
