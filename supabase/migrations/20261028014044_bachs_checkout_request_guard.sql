-- A Bachs POST may time out after the provider created a checkout. Claim the
-- request once, before the network call; never send a second POST while its
-- outcome is unknown. The payment attempt remains the single ledger identity.
alter table public.order_payments
  add column if not exists provider_request_state text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_payments'::regclass
      and conname = 'order_payments_bachs_request_state_shape'
  ) then
    alter table public.order_payments
      add constraint order_payments_bachs_request_state_shape
      check (
        provider_request_state is null
        or (provider = 'BACHS' and provider_request_state in ('RESERVED', 'SENT', 'BOUND', 'REVIEW'))
      ) not valid;
  end if;
end $$;

alter table public.order_payments validate constraint order_payments_bachs_request_state_shape;

create unique index if not exists order_payments_bachs_open_checkout_idx
  on public.order_payments(order_id, phase)
  where provider = 'BACHS' and phase = 'INITIAL_ORDER';

create or replace function public.claim_bachs_checkout_request(
  p_payment_id uuid,
  p_idempotency_key text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.order_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  select * into v_payment from public.order_payments
    where id = p_payment_id for update;
  if not found or v_payment.provider <> 'BACHS'
    or v_payment.idempotency_key is distinct from p_idempotency_key then
    raise exception 'Bachs payment attempt mismatch';
  end if;
  if v_payment.provider_request_state = 'SENT' or v_payment.provider_request_state = 'BOUND'
    or v_payment.provider_request_state = 'REVIEW' then
    return false;
  end if;
  if v_payment.provider_request_state is distinct from 'RESERVED'
    or v_payment.status <> 'INITIATED' or v_payment.provider_payment_id is not null then
    raise exception 'Bachs payment attempt is not reserved';
  end if;
  update public.order_payments set provider_request_state = 'SENT'
    where id = p_payment_id;
  return true;
end;
$$;

create or replace function public.bind_bachs_checkout_request(
  p_payment_id uuid,
  p_idempotency_key text,
  p_checkout_id text,
  p_checkout_url text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.order_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_checkout_id !~ '^chk_[A-Za-z0-9]+$'
    or p_checkout_url !~ '^https://[A-Za-z0-9.-]+[.]bachs[.]io/' then
    raise exception 'Bachs checkout identity invalid';
  end if;
  select * into v_payment from public.order_payments
    where id = p_payment_id for update;
  if not found or v_payment.provider <> 'BACHS'
    or v_payment.idempotency_key is distinct from p_idempotency_key then
    raise exception 'Bachs payment attempt mismatch';
  end if;
  if v_payment.provider_request_state = 'BOUND'
    and v_payment.provider_payment_id = p_checkout_id
    and v_payment.provider_checkout_url = p_checkout_url then
    return false;
  end if;
  if v_payment.provider_request_state <> 'SENT'
    or v_payment.provider_payment_id is not null
    or v_payment.status <> 'INITIATED' then
    raise exception 'Bachs checkout is not ready to bind';
  end if;
  update public.order_payments
    set provider_request_state = 'BOUND',
        provider_payment_id = p_checkout_id,
        provider_checkout_url = p_checkout_url,
        status = 'PENDING'
    where id = p_payment_id;
  return true;
end;
$$;

revoke all on function public.claim_bachs_checkout_request(uuid, text) from public, anon, authenticated;
revoke all on function public.bind_bachs_checkout_request(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_bachs_checkout_request(uuid, text) to service_role;
grant execute on function public.bind_bachs_checkout_request(uuid, text, text, text) to service_role;
