-- Reserve identity is the business promise; provider operations may be retried,
-- but the refund target, amount and provider reference may never be rewritten.
create or replace function public.guard_order_payment_refund_claim_status()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'RESERVED' or new.provider_refund_id is not null then
      raise exception 'New refund claim must start reserved';
    end if;
    return new;
  end if;

  if new.payment_id is distinct from old.payment_id
    or new.order_id is distinct from old.order_id
    or new.phase is distinct from old.phase
    or new.provider is distinct from old.provider
    or new.currency is distinct from old.currency
    or new.charged_amount is distinct from old.charged_amount
    or new.refunded_before is distinct from old.refunded_before
    or new.refund_amount is distinct from old.refund_amount
    or new.provider_payment_id is distinct from old.provider_payment_id
    or new.operation_key is distinct from old.operation_key then
    raise exception 'Refund claim identity is immutable';
  end if;
  if (old.status = 'SUCCEEDED' and new.status <> 'SUCCEEDED')
    or (old.status = 'FAILED_RECONCILED' and new.status not in ('FAILED_RECONCILED', 'SUCCEEDED'))
    or (old.status in ('PROVIDER_UNKNOWN', 'PROVIDER_PENDING') and new.status = 'RESERVED')
    or (new.status = 'SUCCEEDED' and nullif(btrim(new.provider_refund_id), '') is null) then
    raise exception 'Refund claim status transition is unsafe';
  end if;
  if old.provider_refund_id is not null and new.provider_refund_id is distinct from old.provider_refund_id then
    raise exception 'Refund claim provider identity is immutable';
  end if;
  return new;
end;
$$;

create or replace function public.guard_order_payment_refund_attempt()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'RESERVED' or new.provider_refund_id is not null
      or nullif(btrim(new.provider_charge_id), '') is null then
      raise exception 'A new Bachs refund attempt must start reserved with its settled charge ID';
    end if;
    return new;
  end if;

  if new.refund_claim_id is distinct from old.refund_claim_id
    or new.attempt_number is distinct from old.attempt_number
    or new.provider_reference is distinct from old.provider_reference
    or new.idempotency_key is distinct from old.idempotency_key
    or new.provider_charge_id is distinct from old.provider_charge_id then
    raise exception 'Refund attempt identity is immutable';
  end if;
  if (old.status = 'SUCCEEDED' and new.status <> 'SUCCEEDED')
    or (old.status = 'FAILED_RECONCILED' and new.status not in ('FAILED_RECONCILED', 'SUCCEEDED'))
    or (old.status = 'PROVIDER_PENDING' and new.status not in ('PROVIDER_PENDING', 'SUCCEEDED', 'FAILED_RECONCILED', 'PROVIDER_UNKNOWN'))
    or (old.status = 'PROVIDER_UNKNOWN' and new.status not in ('PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED_RECONCILED'))
    or (old.status = 'RESERVED' and new.status not in ('RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED_RECONCILED')) then
    raise exception 'Refund attempt status transition is unsafe';
  end if;
  if old.provider_refund_id is not null and new.provider_refund_id is distinct from old.provider_refund_id then
    raise exception 'Refund attempt provider identity is immutable';
  end if;
  if new.status = 'SUCCEEDED' and nullif(btrim(new.provider_refund_id), '') is null then
    raise exception 'A successful refund attempt requires a provider refund ID';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_order_payment_refund_claim_status() from public, anon, authenticated;
revoke all on function public.guard_order_payment_refund_attempt() from public, anon, authenticated;
