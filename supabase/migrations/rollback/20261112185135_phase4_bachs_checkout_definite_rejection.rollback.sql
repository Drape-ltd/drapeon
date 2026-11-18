drop function if exists public.reject_bachs_checkout_request(uuid, text, integer, text, text[]);

alter table public.order_payments
  drop constraint if exists order_payments_bachs_request_state_shape;

alter table public.order_payments
  add constraint order_payments_bachs_request_state_shape
  check (
    provider_request_state is null
    or (
      provider = 'BACHS'
      and provider_request_state in ('RESERVED', 'SENT', 'BOUND', 'REVIEW')
    )
  ) not valid;

alter table public.order_payments
  validate constraint order_payments_bachs_request_state_shape;

-- Restore the pre-Phase-4 claim behavior. This rollback refuses to reinterpret
-- any row that still records a definite rejection.
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
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;
  select * into v_payment from public.order_payments
    where id = p_payment_id for update;
  if not found or v_payment.provider <> 'BACHS'
    or v_payment.idempotency_key is distinct from p_idempotency_key then
    raise exception 'Bachs payment attempt mismatch';
  end if;
  if v_payment.provider_request_state in ('SENT', 'BOUND', 'REVIEW') then
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

revoke all on function public.claim_bachs_checkout_request(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_bachs_checkout_request(uuid, text) to service_role;
