do $$
begin
  if exists (
    select 1 from public.order_payment_refund_attempts
    where money_desk_request_id is not null
       or reviewed_retry_of_attempt_id is not null
  ) then
    raise exception 'Cannot roll back reviewed Bachs refund retries while retry attempt records exist.';
  end if;
end;
$$;

drop function if exists public.reserve_bachs_payment_refund_retry_attempt(uuid, uuid, uuid);
drop index if exists public.order_payment_refund_attempts_reviewed_retry_idx;
drop index if exists public.order_payment_refund_attempts_review_request_uidx;
alter table public.order_payment_refund_attempts
  drop constraint if exists order_payment_refund_attempts_review_pair_check,
  drop column if exists reviewed_retry_of_attempt_id,
  drop column if exists money_desk_request_id;

-- Restore the pre-retry row guard from 20261028041348. Existing first-attempt
-- rows remain unchanged; only the two reviewed-retry identity fields are removed.
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
  if old.provider_refund_id is not null and new.provider_refund_id is not null
    and old.provider_refund_id <> new.provider_refund_id then
    raise exception 'Refund attempt provider identity is immutable';
  end if;
  if new.status = 'SUCCEEDED' and nullif(btrim(new.provider_refund_id), '') is null then
    raise exception 'A successful refund attempt requires a provider refund ID';
  end if;
  return new;
end;
$$;
