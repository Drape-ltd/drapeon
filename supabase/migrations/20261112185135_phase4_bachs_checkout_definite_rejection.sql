-- A provider-confirmed 4xx checkout rejection did not create money or a
-- checkout. Record that terminal evidence and permit a corrected retry to reuse
-- the same payment attempt and fixed idempotency key. Network/5xx outcomes stay
-- SENT and cannot be retried.

alter table public.order_payments
  drop constraint if exists order_payments_bachs_request_state_shape;

alter table public.order_payments
  add constraint order_payments_bachs_request_state_shape
  check (
    provider_request_state is null
    or (
      provider = 'BACHS'
      and provider_request_state in ('RESERVED', 'SENT', 'BOUND', 'REVIEW', 'REJECTED')
    )
  ) not valid;

alter table public.order_payments
  validate constraint order_payments_bachs_request_state_shape;

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
  if v_payment.provider_request_state = 'REJECTED' then
    if v_payment.status <> 'FAILED' or v_payment.provider_payment_id is not null then
      raise exception 'Rejected Bachs checkout evidence is inconsistent';
    end if;
    update public.order_payments
      set provider_request_state = 'SENT',
          status = 'INITIATED',
          provider_response = coalesce(provider_response, '{}'::jsonb)
            || jsonb_build_object(
              'checkout_retry', jsonb_build_object(
                'reused_idempotency_key', true,
                'started_at', now()
              )
            )
      where id = p_payment_id;
    return true;
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

create or replace function public.reject_bachs_checkout_request(
  p_payment_id uuid,
  p_idempotency_key text,
  p_http_status integer,
  p_provider_code text,
  p_validation_fields text[] default array[]::text[]
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.order_payments%rowtype;
  v_fields text[] := coalesce(p_validation_fields, array[]::text[]);
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_http_status < 400 or p_http_status > 499
    or (p_provider_code is not null and p_provider_code !~ '^[A-Z0-9_]{1,64}$')
    or cardinality(v_fields) > 16
    or exists (
      select 1 from unnest(v_fields) as field
      where field !~ '^[a-z][a-z0-9_]{0,63}$'
    ) then
    raise exception 'Bachs checkout rejection evidence invalid';
  end if;

  select * into v_payment from public.order_payments
    where id = p_payment_id for update;
  if not found or v_payment.provider <> 'BACHS'
    or v_payment.idempotency_key is distinct from p_idempotency_key then
    raise exception 'Bachs payment attempt mismatch';
  end if;
  if v_payment.provider_request_state = 'REJECTED'
    and v_payment.status = 'FAILED'
    and v_payment.provider_payment_id is null then
    return false;
  end if;
  if v_payment.provider_request_state <> 'SENT'
    or v_payment.status <> 'INITIATED'
    or v_payment.provider_payment_id is not null then
    raise exception 'Bachs checkout is not eligible for rejection';
  end if;

  update public.order_payments
    set provider_request_state = 'REJECTED',
        status = 'FAILED',
        provider_response = coalesce(provider_response, '{}'::jsonb)
          || jsonb_build_object(
            'checkout_rejection', jsonb_build_object(
              'http_status', p_http_status,
              'provider_code', p_provider_code,
              'validation_fields', to_jsonb(v_fields),
              'recorded_at', now()
            )
          )
    where id = p_payment_id;
  return true;
end;
$$;

revoke all on function public.claim_bachs_checkout_request(uuid, text)
  from public, anon, authenticated;
revoke all on function public.reject_bachs_checkout_request(uuid, text, integer, text, text[])
  from public, anon, authenticated;
grant execute on function public.claim_bachs_checkout_request(uuid, text) to service_role;
grant execute on function public.reject_bachs_checkout_request(uuid, text, integer, text, text[])
  to service_role;
