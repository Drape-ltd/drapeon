-- A provider refund must first claim one exact payment/refund position. This is
-- a short database transaction: callers perform provider I/O after it commits.
create table public.order_payment_refund_claims (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.order_payments(id),
  order_id text not null,
  phase public.order_payment_phase not null,
  provider public.payment_provider not null,
  currency public.currency not null,
  charged_amount integer not null check (charged_amount > 0),
  refunded_before integer not null check (refunded_before >= 0),
  refund_amount integer not null check (refund_amount > 0),
  provider_payment_id text not null check (length(provider_payment_id) > 0),
  operation_key text not null unique check (length(operation_key) > 0),
  status text not null default 'RESERVED' check (status in
    ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING','SUCCEEDED','FAILED_RECONCILED')),
  provider_refund_id text,
  provider_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, refunded_before),
  check (refunded_before + refund_amount <= charged_amount)
);

comment on table public.order_payment_refund_claims is
  'Durable reservation for one refund operation at an exact payment position. Do not call a provider inside the reservation transaction.';
create index order_payment_refund_claims_order_idx
  on public.order_payment_refund_claims(order_id, created_at desc);
alter table public.order_payment_refund_claims enable row level security;
revoke all on public.order_payment_refund_claims from public, anon, authenticated;
grant select, insert, update on public.order_payment_refund_claims to service_role;

create function public.reserve_order_payment_refund_claim(
  p_payment_id uuid,
  p_order_id text,
  p_phase public.order_payment_phase,
  p_provider public.payment_provider,
  p_provider_payment_id text,
  p_operation_key text,
  p_refund_amount integer
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_payment public.order_payments%rowtype;
  v_claim public.order_payment_refund_claims%rowtype;
  v_refunded integer;
begin
  if p_payment_id is null or p_order_id is null or p_phase is null
    or p_provider is null or nullif(btrim(p_provider_payment_id),'') is null
    or nullif(btrim(p_operation_key),'') is null or coalesce(p_refund_amount,0) <= 0 then
    return jsonb_build_object('outcome','INVALID_REQUEST');
  end if;

  select * into v_payment from public.order_payments
    where id=p_payment_id for update;
  if not found then
    return jsonb_build_object('outcome','NOT_FOUND');
  end if;
  if v_payment.order_id::text is distinct from p_order_id
    or v_payment.phase is distinct from p_phase
    or v_payment.provider is distinct from p_provider
    or v_payment.provider_payment_id is distinct from p_provider_payment_id then
    return jsonb_build_object('outcome','IDENTITY_CONFLICT');
  end if;

  -- A same-key retry recovers the original claim, even after ledger finalization.
  select * into v_claim from public.order_payment_refund_claims
    where operation_key=p_operation_key;
  if found then
    if v_claim.payment_id <> p_payment_id or v_claim.order_id <> p_order_id
      or v_claim.phase <> p_phase or v_claim.provider <> p_provider
      or v_claim.provider_payment_id <> p_provider_payment_id
      or v_claim.refund_amount <> p_refund_amount then
      return jsonb_build_object('outcome','IDENTITY_CONFLICT');
    end if;
    return jsonb_build_object('outcome','EXISTING','claim_id',v_claim.id,
      'status',v_claim.status,'refunded_before',v_claim.refunded_before);
  end if;

  v_refunded := coalesce(v_payment.refunded_amount,0);
  if v_payment.status not in ('SUCCEEDED','PARTIAL_REFUND')
    or v_payment.amount <= 0 or v_refunded < 0
    or v_refunded + p_refund_amount > v_payment.amount then
    return jsonb_build_object('outcome','NOT_REFUNDABLE');
  end if;

  select * into v_claim from public.order_payment_refund_claims
    where payment_id=p_payment_id and refunded_before=v_refunded;
  if found then
    return jsonb_build_object('outcome','POSITION_CLAIMED',
      'claim_id',v_claim.id,'status',v_claim.status);
  end if;

  insert into public.order_payment_refund_claims (
    payment_id, order_id, phase, provider, currency, charged_amount,
    refunded_before, refund_amount, provider_payment_id, operation_key
  ) values (
    v_payment.id, v_payment.order_id::text, v_payment.phase,
    v_payment.provider, v_payment.currency, v_payment.amount,
    v_refunded, p_refund_amount, v_payment.provider_payment_id, p_operation_key
  ) returning * into v_claim;
  return jsonb_build_object('outcome','RESERVED','claim_id',v_claim.id,
    'status',v_claim.status,'refunded_before',v_claim.refunded_before);
end;
$$;

revoke all on function public.reserve_order_payment_refund_claim(
  uuid,text,public.order_payment_phase,public.payment_provider,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.reserve_order_payment_refund_claim(
  uuid,text,public.order_payment_phase,public.payment_provider,text,text,integer)
  to service_role;
