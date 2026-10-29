do $$
begin
  if exists (
    select 1 from public.order_payment_refund_attempts
    where provider_charge_id is not null
  ) then
    raise exception 'Cannot roll back immutable Bachs charge identities after they have been recorded';
  end if;
end;
$$;

alter table public.order_payment_refund_attempts
  drop constraint if exists order_payment_refund_attempts_charge_format_check,
  drop column if exists provider_charge_id;

create or replace function public.guard_order_payment_refund_attempt()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'RESERVED' or new.provider_refund_id is not null then
      raise exception 'A new refund attempt must start reserved';
    end if;
    return new;
  end if;

  if new.refund_claim_id is distinct from old.refund_claim_id
    or new.attempt_number is distinct from old.attempt_number
    or new.provider_reference is distinct from old.provider_reference
    or new.idempotency_key is distinct from old.idempotency_key then
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

create or replace function public.reserve_bachs_payment_refund_attempt(p_claim_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_claim public.order_payment_refund_claims%rowtype;
  v_attempt public.order_payment_refund_attempts%rowtype;
  v_last public.order_payment_refund_attempts%rowtype;
  v_number integer;
begin
  if p_claim_id is null then return jsonb_build_object('outcome', 'INVALID_REQUEST'); end if;
  select * into v_claim from public.order_payment_refund_claims where id = p_claim_id for update;
  if not found then return jsonb_build_object('outcome', 'NOT_FOUND'); end if;
  if v_claim.provider <> 'BACHS' then return jsonb_build_object('outcome', 'PROVIDER_MISMATCH'); end if;
  if v_claim.status = 'SUCCEEDED' then
    return jsonb_build_object('outcome', 'CLAIM_FINALIZED', 'claim_id', v_claim.id);
  end if;

  select * into v_attempt from public.order_payment_refund_attempts
    where refund_claim_id = p_claim_id
      and status in ('RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING')
    order by attempt_number desc limit 1;
  if found then
    return jsonb_build_object(
      'outcome', 'EXISTING', 'claim_id', p_claim_id, 'attempt_id', v_attempt.id,
      'attempt_number', v_attempt.attempt_number, 'status', v_attempt.status,
      'provider_reference', v_attempt.provider_reference, 'idempotency_key', v_attempt.idempotency_key,
      'provider_refund_id', v_attempt.provider_refund_id
    );
  end if;

  select * into v_last from public.order_payment_refund_attempts
    where refund_claim_id = p_claim_id order by attempt_number desc limit 1;
  if found and v_last.status <> 'FAILED_RECONCILED' then
    return jsonb_build_object('outcome', 'UNRESOLVED_PRIOR_ATTEMPT', 'claim_id', p_claim_id,
      'attempt_id', v_last.id, 'status', v_last.status);
  end if;
  select coalesce(max(attempt_number), 0) + 1 into v_number
    from public.order_payment_refund_attempts where refund_claim_id = p_claim_id;

  insert into public.order_payment_refund_attempts (
    refund_claim_id, attempt_number, provider_reference, idempotency_key
  ) values (
    p_claim_id,
    v_number,
    'refund_' || replace(p_claim_id::text, '-', '') || '_' || v_number::text,
    'drapeon-refund:' || replace(p_claim_id::text, '-', '') || ':' || v_number::text
  ) returning * into v_attempt;
  return jsonb_build_object(
    'outcome', 'RESERVED', 'claim_id', p_claim_id, 'attempt_id', v_attempt.id,
    'attempt_number', v_attempt.attempt_number, 'status', v_attempt.status,
    'provider_reference', v_attempt.provider_reference, 'idempotency_key', v_attempt.idempotency_key,
    'provider_refund_id', v_attempt.provider_refund_id
  );
end;
$$;
