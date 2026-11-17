-- Supabase secret API keys are authorized by PostgREST role mapping rather than
-- JWT claim settings. EXECUTE remains granted only to service_role, so the
-- redundant in-body JWT-setting check would reject valid server calls.

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
