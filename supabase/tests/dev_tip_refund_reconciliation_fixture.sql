create extension if not exists pgcrypto;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create type public.currency as enum ('USD');
create type public.order_payment_status as enum ('SUCCEEDED','REFUNDED');

create table public.money_desk_requests (
  id uuid primary key, status text, action_type text, target_type text, target_id text,
  order_id text, amount integer, currency public.currency, required_approval_count integer,
  approval_count integer, approved_at timestamptz, requester_email text,
  action_payload jsonb, correlation_id uuid
);
create table public.money_desk_execution_attempts (
  id uuid primary key, request_id uuid, status text, provider_reference text
);
create table public.money_desk_decisions (
  request_id uuid, decision text, approver_email text, approver_role text
);
create table public.order_tips (
  id uuid primary key, order_id text, payment_id uuid, amount integer,
  currency public.currency, status text
);
create table public.order_payments (
  id uuid primary key, order_id text, phase text, provider text,
  provider_payment_id text, amount integer, currency public.currency,
  status public.order_payment_status, refunded_amount integer
);
create table public.tip_money_operation_claims (
  id uuid primary key, tip_id uuid, operation_kind text, money_desk_request_id uuid,
  status text, refund_funding_mode text, provider_operation_id text,
  provider text, provider_response jsonb, updated_at timestamptz
);
create table public.order_payment_provider_refunds (
  payment_id uuid, provider text, provider_refund_id text, amount integer,
  status text
);
create table public.payouts (source_payment_id uuid, payout_purpose text);
create table public.commercial_ledger_transactions (
  id uuid primary key default gen_random_uuid(), payment_id uuid, order_id text,
  transaction_kind text, purpose text, provider_reference text,
  original_amount integer, original_currency public.currency,
  policy_version text, pricing_version integer, correlation_id uuid,
  idempotency_key text unique
);
create table public.commercial_ledger_entries (
  id uuid primary key default gen_random_uuid(), transaction_id uuid,
  account_code text, account_scope text, direction text, amount integer,
  currency public.currency
);

create or replace function public.current_ops_environment() returns text
language sql as $$ select 'DEVELOPMENT'::text $$;
create or replace function public.record_confirmed_order_payment_refund(
  p_payment_id uuid,p_provider_refund_id text,p_amount integer,p_provider_response jsonb
) returns jsonb language plpgsql as $$
begin
  update public.order_payments set status='REFUNDED',refunded_amount=p_amount
    where id=p_payment_id and status='SUCCEEDED' and amount=p_amount;
  if not found then raise exception 'payment refund precondition failed'; end if;
  insert into public.order_payment_provider_refunds values
    (p_payment_id,'STRIPE',p_provider_refund_id,p_amount,'CONFIRMED');
  return jsonb_build_object('ok',true);
end $$;
create or replace function public.record_tip_money_operation_outcome(
  p_claim_id uuid,p_next_status text,p_provider text,p_provider_operation_id text,p_provider_response jsonb
) returns jsonb language plpgsql as $$
begin
  update public.tip_money_operation_claims
    set status=p_next_status,provider=p_provider,provider_operation_id=p_provider_operation_id,
      provider_response=p_provider_response,updated_at=now()
    where id=p_claim_id and status='RESERVED';
  if not found then raise exception 'claim outcome precondition failed'; end if;
  return jsonb_build_object('ok',true);
end $$;
create or replace function public.post_commercial_ledger_transaction(
  p_idempotency_key text,p_transaction_kind text,p_purpose text,p_order_id text,
  p_payment_id uuid,p_policy_version text,p_pricing_version integer,
  p_correlation_id uuid,p_provider_reference text,p_entries jsonb,
  p_metadata jsonb,p_reversal_of_transaction_id uuid,p_actor_role text,
  p_original_currency public.currency,p_original_amount integer,
  p_settlement_currency public.currency,p_settlement_amount integer
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.commercial_ledger_transactions
    (payment_id,order_id,transaction_kind,purpose,provider_reference,original_amount,
     original_currency,policy_version,pricing_version,correlation_id,idempotency_key)
  values (p_payment_id,p_order_id,p_transaction_kind,p_purpose,p_provider_reference,
    p_original_amount,p_original_currency,p_policy_version,p_pricing_version,
    p_correlation_id,p_idempotency_key) returning id into v_id;
  insert into public.commercial_ledger_entries
    (transaction_id,account_code,account_scope,direction,amount,currency)
  select v_id, entry->>'accountCode',entry->>'accountScope',entry->>'direction',
    (entry->>'amount')::integer,(entry->>'currency')::public.currency
  from jsonb_array_elements(p_entries) entry;
  return v_id;
end $$;
create or replace function public.finalize_claimed_tip_refund(
  p_tip_id uuid,p_claim_id uuid,p_provider_refund_id text
) returns jsonb language plpgsql as $$
begin
  update public.order_tips set status='REFUNDED' where id=p_tip_id and status='HELD';
  if not found then raise exception 'tip finalization precondition failed'; end if;
  return jsonb_build_object('outcome','FINALIZED');
end $$;
create or replace function public.complete_money_desk_execution(
  p_attempt_id uuid,p_status text,p_provider_reference text,
  p_failure_code text,p_failure_summary text
) returns jsonb language plpgsql as $$
declare v_request_id uuid;
begin
  update public.money_desk_execution_attempts
    set status=p_status,provider_reference=p_provider_reference
    where id=p_attempt_id and status='PROCESSING' returning request_id into v_request_id;
  if v_request_id is null then raise exception 'attempt completion precondition failed'; end if;
  update public.money_desk_requests set status=p_status where id=v_request_id;
  return jsonb_build_object('status',p_status);
end $$;

insert into public.money_desk_requests values
('11111111-1111-4111-8111-111111111111','FAILED','CUSTOMER_REFUND','ORDER_TIP',
 '33333333-3333-4333-8333-333333333333','order-one',500,'USD',1,1,now(),
 'old-preparer', '{}'::jsonb,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
('22222222-2222-4222-8222-222222222222','EXECUTING','OTHER_REVIEWED','TIP_REFUND_RECONCILIATION',
 '33333333-3333-4333-8333-333333333333','order-one',500,'USD',2,2,now(),
 'preparer', jsonb_build_object('tipId','33333333-3333-4333-8333-333333333333',
  'paymentId','44444444-4444-4444-8444-444444444444',
  'refundClaimId','55555555-5555-4555-8555-555555555555',
  'previousRequestId','11111111-1111-4111-8111-111111111111',
  'paymentIntentId','pi_one','providerRefundId','re_one'),
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.money_desk_execution_attempts values
('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','PROCESSING',null);
insert into public.money_desk_decisions values
('22222222-2222-4222-8222-222222222222','APPROVE','approver-one','ADMIN'),
('22222222-2222-4222-8222-222222222222','APPROVE','approver-two','FINANCE');
insert into public.order_tips values
('33333333-3333-4333-8333-333333333333','order-one',
 '44444444-4444-4444-8444-444444444444',500,'USD','HELD');
insert into public.order_payments values
('44444444-4444-4444-8444-444444444444','order-one','TIP','STRIPE',
 'pi_one',500,'USD','SUCCEEDED',0);
insert into public.tip_money_operation_claims values
('55555555-5555-4555-8555-555555555555',
 '33333333-3333-4333-8333-333333333333','REFUND',
 '11111111-1111-4111-8111-111111111111','RESERVED','UNPAID_TIP',
 null,'STRIPE','{}'::jsonb,now());
insert into public.commercial_ledger_transactions
  (id,payment_id,order_id,transaction_kind,purpose,provider_reference,
   original_amount,original_currency,policy_version,pricing_version,correlation_id,idempotency_key)
values ('77777777-7777-4777-8777-777777777777',
 '44444444-4444-4444-8444-444444444444','order-one','CAPTURE','TIP','pi_one',
 500,'USD','policy-one',1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','capture-one');
insert into public.commercial_ledger_entries
  (transaction_id,account_code,account_scope,direction,amount,currency) values
('77777777-7777-4777-8777-777777777777','PROVIDER_CLEARING','STRIPE','DEBIT',500,'USD'),
('77777777-7777-4777-8777-777777777777','TIP_LIABILITY','order-one','CREDIT',500,'USD');
