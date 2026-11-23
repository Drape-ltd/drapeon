create extension if not exists pgcrypto;
create schema payment_internal;
create type public.currency as enum ('USD','CAD','GBP');
create type public.payment_provider as enum ('STRIPE','PAYSTACK');

create table public.orders(id text primary key,id_text text unique,tailor_profile_id text);
create table public.order_payments(
  id uuid primary key,order_id text,provider public.payment_provider,
  currency public.currency,phase text,status text,amount integer,
  refunded_amount integer,ledger_recorded_at timestamptz
);
create table public.payouts(
  id text primary key,order_id text,tailor_profile_id text,
  source_payment_id uuid,provider public.payment_provider,currency public.currency,
  amount integer,status text,payout_purpose text,settlement_tranche_id uuid
);
create table public.payout_claims(
  id uuid primary key,business_key text,source_kind text,source_id text,order_id text,
  tailor_profile_id text,payout_id text,provider text,currency public.currency,
  amount integer,status text,transfer_status text,provider_transfer_id text
);
create table public.payout_provider_operations(
  id uuid primary key,claim_id uuid,operation_number integer,
  unique (claim_id,operation_number)
);
create table public.order_settlement_plans(
  id uuid primary key,order_id text,source_payment_id uuid,
  currency public.currency,status text,entitlement_amount integer,
  seller_subtotal_amount integer,excluded_fabric_allowance_amount integer
);
create table public.order_settlement_tranches(
  id uuid primary key,plan_id uuid,order_id text,amount integer,
  currency public.currency,status text,payout_id text
);
create table public.order_work_funding_positions(
  id uuid primary key,payout_claim_id uuid,use_kind text,
  source_payment_id uuid,amount integer,status text
);
create table public.order_payment_refund_claims(
  id uuid primary key,payment_id uuid,status text
);
create table public.disputes(id text primary key,order_id text,status text);
create table public.provider_disputes(
  id uuid primary key,order_id text,money_movement_blocked boolean
);
create table public.commercial_ledger_transactions(
  id uuid primary key,payment_id uuid,order_id text,transaction_kind text,
  purpose text,original_amount integer,settlement_amount integer,
  original_currency public.currency,settlement_currency public.currency,
  reversal_of_transaction_id uuid,provider_reference text
);
create table public.order_payment_provider_refunds(
  id uuid primary key,payment_id uuid,status text,
  provider public.payment_provider,provider_refund_id text,amount integer
);
create table public.commercial_ledger_entries(
  id uuid primary key,transaction_id uuid,direction text,
  account_code text,currency public.currency,amount integer
);
