-- Serialize Money Desk post-payout consultation refunds without reopening or
-- changing the tailor's already released earning.

create table public.consultation_post_payout_refund_claims (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.consultation_bookings(id) on delete restrict,
  payment_id uuid not null references public.order_payments(id) on delete restrict,
  money_desk_request_id uuid not null references public.money_desk_requests(id) on delete restrict,
  provider payment_provider not null,
  provider_payment_id text not null,
  provider_refund_id text,
  amount integer not null check (amount > 0),
  currency public.currency not null,
  status text not null default 'CLAIMED'
    check (status in ('CLAIMED','PROCESSING','PROVIDER_CONFIRMED','SUCCEEDED','OPS_REVIEW','FAILED')),
  idempotency_key text not null unique,
  provider_response jsonb not null default '{}'::jsonb,
  ledger_transaction_id uuid references public.commercial_ledger_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (money_desk_request_id),
  check ((status = 'SUCCEEDED') = (ledger_transaction_id is not null))
);

-- Dev and the local baseline use different physical types for payouts.id
-- (text in Dev, uuid locally). Match the source column's actual type so the
-- claim retains a real FK without changing either existing schema.
do $$
declare
  v_payout_id_type text;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
    into v_payout_id_type
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.payouts'::regclass
    and attribute.attname = 'id'
    and attribute.attnum > 0
    and not attribute.attisdropped;
  if v_payout_id_type not in ('uuid', 'text') then
    raise exception 'Unsupported public.payouts.id type for consultation refund claim: %', v_payout_id_type;
  end if;
  execute format(
    'alter table public.consultation_post_payout_refund_claims add column payout_id %s not null references public.payouts(id) on delete restrict',
    v_payout_id_type
  );
end;
$$;

create unique index consultation_post_payout_refund_one_active_booking_idx
  on public.consultation_post_payout_refund_claims(booking_id)
  where status in ('CLAIMED','PROCESSING','PROVIDER_CONFIRMED','OPS_REVIEW');

create unique index consultation_post_payout_refund_provider_ref_idx
  on public.consultation_post_payout_refund_claims(provider, provider_refund_id)
  where provider_refund_id is not null;

create index consultation_post_payout_refund_payment_idx
  on public.consultation_post_payout_refund_claims(payment_id, created_at desc);

alter table public.consultation_post_payout_refund_claims enable row level security;
revoke all on public.consultation_post_payout_refund_claims from public, anon, authenticated, service_role;
grant select on public.consultation_post_payout_refund_claims to service_role;

create or replace function public.claim_consultation_post_payout_refund(
  p_booking_id uuid,
  p_payment_id uuid,
  p_money_desk_request_id uuid,
  p_amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.consultation_bookings%rowtype;
  v_payment public.order_payments%rowtype;
  v_payout public.payouts%rowtype;
  v_request public.money_desk_requests%rowtype;
  v_claim public.consultation_post_payout_refund_claims%rowtype;
  v_remaining integer;
begin
  select * into v_booking from public.consultation_bookings
    where id = p_booking_id for update;
  if not found then return jsonb_build_object('status','BOOKING_NOT_FOUND'); end if;

  select * into v_request from public.money_desk_requests
    where id = p_money_desk_request_id for update;
  if not found
    or v_request.action_type <> 'CUSTOMER_REFUND'
    or v_request.target_type <> 'CONSULTATION_BOOKING'
    or v_request.target_id <> p_booking_id::text
    or v_request.order_id::text <> v_booking.order_id::text
    or v_request.status <> 'EXECUTING'
    or v_request.amount <> p_amount
    or v_request.currency::text <> v_booking.fee_currency::text then
    return jsonb_build_object('status','MONEY_DESK_REQUEST_MISMATCH');
  end if;

  select * into v_payment from public.order_payments
    where id = p_payment_id for update;
  if not found
    or v_payment.phase::text <> 'CONSULTATION'
    or v_payment.consultation_booking_id <> p_booking_id
    or coalesce(v_payment.consultation_booking_link_source::text,'') not in ('PREPARED','BACKFILL','LEGACY_VERIFIED')
    or v_payment.order_id::text <> v_booking.order_id::text
    or v_payment.amount <> v_booking.fee_amount
    or v_payment.currency::text <> v_booking.fee_currency::text
    or v_payment.status::text not in ('SUCCEEDED','PARTIAL_REFUND')
    or nullif(btrim(v_payment.provider_payment_id), '') is null then
    return jsonb_build_object('status','PAYMENT_LINK_MISMATCH');
  end if;
  v_remaining := v_payment.amount - coalesce(v_payment.refunded_amount, 0);
  if p_amount <= 0 or p_amount > v_remaining then
    return jsonb_build_object('status','REFUND_EXCEEDS_REMAINING');
  end if;

  if v_booking.settlement_status <> 'RELEASED' or v_booking.payout_id is null then
    return jsonb_build_object('status','PAYOUT_NOT_CONFIRMED');
  end if;
  select * into v_payout from public.payouts
    where id::text = v_booking.payout_id::text for update;
  if not found
    or v_payout.provider_transfer_status not in ('AVAILABLE_IN_PROVIDER_BALANCE','PAID_TO_BANK')
    or nullif(btrim(v_payout.provider_payout_id), '') is null
    or v_payout.source_payment_id <> p_payment_id then
    return jsonb_build_object('status','PAYOUT_NOT_CONFIRMED');
  end if;

  select * into v_claim from public.consultation_post_payout_refund_claims
    where money_desk_request_id = p_money_desk_request_id;
  if found then
    return jsonb_build_object(
      'created',false,
      'status',v_claim.status,
      'claimId',v_claim.id,
      'payoutId',v_claim.payout_id,
      'idempotencyKey',v_claim.idempotency_key,
      'providerReference',v_claim.provider_refund_id,
      'providerResponse',v_claim.provider_response,
      'ledgerTransactionId',v_claim.ledger_transaction_id
    );
  end if;

  insert into public.consultation_post_payout_refund_claims (
    booking_id,payment_id,payout_id,money_desk_request_id,provider,
    provider_payment_id,amount,currency,idempotency_key
  ) values (
    p_booking_id,p_payment_id,v_payout.id,v_request.id,v_payment.provider,
    v_payment.provider_payment_id,p_amount,v_payment.currency,
    'consultation-refund:' || p_booking_id::text || ':' || v_request.id::text
  ) returning * into v_claim;

  return jsonb_build_object(
    'created',true,
    'status',v_claim.status,
    'claimId',v_claim.id,
    'payoutId',v_claim.payout_id,
    'idempotencyKey',v_claim.idempotency_key,
    'providerReference',v_claim.provider_refund_id,
    'providerResponse',v_claim.provider_response,
    'ledgerTransactionId',v_claim.ledger_transaction_id
  );
exception when unique_violation then
  return jsonb_build_object('status','CLAIM_CONFLICT');
end;
$$;

revoke all on function public.claim_consultation_post_payout_refund(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_consultation_post_payout_refund(uuid, uuid, uuid, integer) to service_role;

comment on function public.claim_consultation_post_payout_refund(uuid, uuid, uuid, integer) is
  'Reserves a reviewed consultation refund only after provider-confirmed payout; the released tailor earning remains unchanged.';

create or replace function public.record_consultation_post_payout_refund_provider_result(
  p_claim_id uuid,
  p_provider_refund_id text,
  p_provider_status text,
  p_provider_response jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.consultation_post_payout_refund_claims%rowtype;
  v_next_status text;
begin
  if nullif(btrim(p_provider_refund_id), '') is null
    or p_provider_status not in ('PROCESSING','PROVIDER_CONFIRMED','OPS_REVIEW') then
    raise exception 'Invalid provider refund outcome.' using errcode = '22023';
  end if;
  select * into v_claim from public.consultation_post_payout_refund_claims
    where id = p_claim_id for update;
  if not found then return 'NOT_FOUND'; end if;
  if v_claim.status = 'SUCCEEDED' then
    if v_claim.provider_refund_id = p_provider_refund_id then return 'ALREADY_SUCCEEDED'; end if;
    return 'PROVIDER_REFERENCE_MISMATCH';
  end if;
  if v_claim.provider_refund_id is not null and v_claim.provider_refund_id <> p_provider_refund_id then
    update public.consultation_post_payout_refund_claims
      set status = 'OPS_REVIEW', updated_at = now()
      where id = p_claim_id;
    return 'PROVIDER_REFERENCE_MISMATCH';
  end if;
  if v_claim.status not in ('CLAIMED','PROCESSING','PROVIDER_CONFIRMED','OPS_REVIEW') then
    return 'CLAIM_TERMINAL';
  end if;
  v_next_status := case
    when v_claim.status = 'PROVIDER_CONFIRMED' then 'PROVIDER_CONFIRMED'
    when p_provider_status = 'PROVIDER_CONFIRMED' then 'PROVIDER_CONFIRMED'
    when p_provider_status = 'OPS_REVIEW' then 'OPS_REVIEW'
    else 'PROCESSING'
  end;
  update public.consultation_post_payout_refund_claims
    set provider_refund_id = p_provider_refund_id,
        provider_response = coalesce(p_provider_response, '{}'::jsonb),
        status = v_next_status,
        updated_at = now()
    where id = p_claim_id;
  return v_next_status;
end;
$$;

create or replace function public.finalize_consultation_post_payout_refund_claim(
  p_claim_id uuid,
  p_ledger_transaction_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.consultation_post_payout_refund_claims%rowtype;
  v_transaction public.commercial_ledger_transactions%rowtype;
begin
  select * into v_claim from public.consultation_post_payout_refund_claims
    where id = p_claim_id for update;
  if not found then return 'NOT_FOUND'; end if;
  if v_claim.status = 'SUCCEEDED' and v_claim.ledger_transaction_id = p_ledger_transaction_id then
    return 'ALREADY_SUCCEEDED';
  end if;
  if v_claim.status <> 'PROVIDER_CONFIRMED' or v_claim.provider_refund_id is null then
    return 'PROVIDER_REFUND_NOT_CONFIRMED';
  end if;
  select * into v_transaction from public.commercial_ledger_transactions
    where id = p_ledger_transaction_id;
  if not found
    or v_transaction.transaction_kind <> 'REFUND'
    or v_transaction.payment_id <> v_claim.payment_id
    or v_transaction.order_id::text <> (select booking.order_id::text from public.consultation_bookings booking where booking.id = v_claim.booking_id)
    or v_transaction.provider_reference <> v_claim.provider_refund_id
    or v_transaction.metadata -> 'consultation_funded_refund' ->> 'claim_id' <> p_claim_id::text then
    return 'LEDGER_MISMATCH';
  end if;
  update public.consultation_post_payout_refund_claims
    set status = 'SUCCEEDED', ledger_transaction_id = p_ledger_transaction_id, updated_at = now()
    where id = p_claim_id;
  return 'SUCCEEDED';
end;
$$;

create or replace function public.mark_consultation_post_payout_refund_ops_review(
  p_claim_id uuid,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.consultation_post_payout_refund_claims
    set status = case when status = 'SUCCEEDED' then status else 'OPS_REVIEW' end,
        provider_response = provider_response || jsonb_build_object('ops_review_reason', left(coalesce(p_reason, 'Provider outcome requires reconciliation.'), 500)),
        updated_at = now()
    where id = p_claim_id
    returning status into v_status;
  if not found then return 'NOT_FOUND'; end if;
  return v_status;
end;
$$;

revoke all on function public.record_consultation_post_payout_refund_provider_result(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_consultation_post_payout_refund_provider_result(uuid, text, text, jsonb) to service_role;
revoke all on function public.finalize_consultation_post_payout_refund_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_consultation_post_payout_refund_claim(uuid, uuid) to service_role;
revoke all on function public.mark_consultation_post_payout_refund_ops_review(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_consultation_post_payout_refund_ops_review(uuid, text) to service_role;
