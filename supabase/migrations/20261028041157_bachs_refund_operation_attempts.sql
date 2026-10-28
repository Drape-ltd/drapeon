-- Keep a refund claim immutable while allowing separately keyed, provider-
-- confirmed attempts after Bachs reports a terminal failure.
create table public.order_payment_refund_attempts (
  id uuid primary key default gen_random_uuid(),
  refund_claim_id uuid not null references public.order_payment_refund_claims(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  provider_reference text not null unique check (length(provider_reference) between 1 and 128),
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 255),
  status text not null default 'RESERVED' check (status in (
    'RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED_RECONCILED'
  )),
  provider_refund_id text,
  provider_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (refund_claim_id, attempt_number),
  check (provider_refund_id is null or length(provider_refund_id) between 1 and 200)
);

create unique index order_payment_refund_attempts_one_active_idx
  on public.order_payment_refund_attempts(refund_claim_id)
  where status in ('RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING');
create index order_payment_refund_attempts_claim_history_idx
  on public.order_payment_refund_attempts(refund_claim_id, attempt_number desc);
alter table public.order_payment_refund_attempts enable row level security;
revoke all on public.order_payment_refund_attempts from public, anon, authenticated;
grant select, insert, update on public.order_payment_refund_attempts to service_role;

create function public.guard_order_payment_refund_attempt()
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
create trigger order_payment_refund_attempt_guard
  before insert or update on public.order_payment_refund_attempts
  for each row execute function public.guard_order_payment_refund_attempt();
revoke all on function public.guard_order_payment_refund_attempt() from public, anon, authenticated;

create function public.reserve_bachs_payment_refund_attempt(p_claim_id uuid)
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
revoke all on function public.reserve_bachs_payment_refund_attempt(uuid) from public, anon, authenticated;
grant execute on function public.reserve_bachs_payment_refund_attempt(uuid) to service_role;

create function public.record_bachs_payment_refund_attempt_outcome(
  p_attempt_id uuid,
  p_next_status text,
  p_provider_refund_id text,
  p_provider_evidence jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_claim public.order_payment_refund_claims%rowtype;
  v_attempt public.order_payment_refund_attempts%rowtype;
  v_claim_status text;
  v_result text := 'RECORDED';
begin
  if p_attempt_id is null or p_next_status not in (
    'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED_RECONCILED'
  ) or p_provider_evidence is null or jsonb_typeof(p_provider_evidence) <> 'object'
    or pg_column_size(p_provider_evidence) > 32768
    or (p_next_status = 'SUCCEEDED' and nullif(btrim(p_provider_refund_id), '') is null) then
    return jsonb_build_object('outcome', 'INVALID_REQUEST');
  end if;

  select c.* into v_claim from public.order_payment_refund_claims c
    join public.order_payment_refund_attempts a on a.refund_claim_id = c.id
    where a.id = p_attempt_id for update of c;
  if not found then return jsonb_build_object('outcome', 'NOT_FOUND'); end if;
  select * into v_attempt from public.order_payment_refund_attempts where id = p_attempt_id for update;
  if v_claim.provider <> 'BACHS' then return jsonb_build_object('outcome', 'PROVIDER_MISMATCH'); end if;
  if v_attempt.provider_refund_id is not null
    and nullif(btrim(p_provider_refund_id), '') is not null
    and v_attempt.provider_refund_id <> nullif(btrim(p_provider_refund_id), '') then
    return jsonb_build_object('outcome', 'IDENTITY_CONFLICT');
  end if;
  if v_attempt.status = 'SUCCEEDED' and p_next_status <> 'SUCCEEDED'
    or v_attempt.status = 'FAILED_RECONCILED' and p_next_status not in ('FAILED_RECONCILED', 'SUCCEEDED') then
    return jsonb_build_object('outcome', 'TERMINAL_CONFLICT');
  end if;
  if v_attempt.status = p_next_status
    and (nullif(btrim(p_provider_refund_id), '') is null
      or v_attempt.provider_refund_id = nullif(btrim(p_provider_refund_id), '')) then
    return jsonb_build_object('outcome', 'EXISTING', 'claim_id', v_claim.id,
      'attempt_id', v_attempt.id, 'status', v_attempt.status,
      'provider_refund_id', v_attempt.provider_refund_id);
  end if;

  update public.order_payment_refund_attempts set
    status = p_next_status,
    provider_refund_id = coalesce(provider_refund_id, nullif(btrim(p_provider_refund_id), '')),
    provider_evidence = p_provider_evidence,
    updated_at = now()
  where id = p_attempt_id returning * into v_attempt;

  if p_next_status = 'SUCCEEDED' then
    if v_claim.status = 'SUCCEEDED' and v_claim.provider_refund_id is distinct from v_attempt.provider_refund_id then
      v_result := 'SECOND_SUCCESS_NEEDS_OPS';
    elsif v_claim.status = 'FAILED_RECONCILED' then
      v_result := 'LATE_SUCCESS';
    end if;
    v_claim_status := 'SUCCEEDED';
  elsif p_next_status = 'FAILED_RECONCILED' then
    v_claim_status := 'FAILED_RECONCILED';
  elsif v_claim.status = 'FAILED_RECONCILED' or v_claim.status = 'SUCCEEDED' then
    v_claim_status := v_claim.status;
  else
    v_claim_status := p_next_status;
  end if;

  if v_claim_status <> v_claim.status then
    update public.order_payment_refund_claims set
      status = v_claim_status,
      provider_refund_id = case when v_claim_status = 'SUCCEEDED'
        then coalesce(provider_refund_id, v_attempt.provider_refund_id) else provider_refund_id end,
      provider_evidence = p_provider_evidence,
      refund_context = coalesce(refund_context, jsonb_build_object(
        'provider', 'BACHS', 'attempt_id', v_attempt.id,
        'provider_reference', v_attempt.provider_reference
      )),
      updated_at = now()
    where id = v_claim.id;
  end if;

  return jsonb_build_object('outcome', v_result, 'claim_id', v_claim.id,
    'attempt_id', v_attempt.id, 'status', v_attempt.status,
    'provider_refund_id', v_attempt.provider_refund_id,
    'claim_status', v_claim_status);
end;
$$;
revoke all on function public.record_bachs_payment_refund_attempt_outcome(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_bachs_payment_refund_attempt_outcome(uuid, text, text, jsonb)
  to service_role;
