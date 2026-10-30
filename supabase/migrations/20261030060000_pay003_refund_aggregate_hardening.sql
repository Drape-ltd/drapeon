-- PAY-003 follow-up: make every provider use one refund aggregate and enforce
-- complete amount invariants for direct writes.

create or replace function public.guard_order_payment_forward_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old text := old.status::text;
  v_new text := new.status::text;
  v_late_success boolean := coalesce(current_setting('drape.payment_late_success', true), '') = 'evidenced';
  v_refund_failure boolean := coalesce(current_setting('drape.payment_refund_failure', true), '') = 'evidenced';
begin
  if coalesce(new.refunded_amount, 0) < 0
     or coalesce(new.refunded_amount, 0) > new.amount then
    raise exception 'PAYMENT_REFUNDED_AMOUNT_OUT_OF_RANGE';
  end if;
  if v_new = 'PARTIAL_REFUND'
     and (coalesce(new.refunded_amount, 0) <= 0 or new.refunded_amount >= new.amount) then
    raise exception 'PARTIAL_REFUND_REQUIRES_PARTIAL_AMOUNT';
  end if;
  if v_old in ('SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED') and (
    new.amount is distinct from old.amount
    or new.currency is distinct from old.currency
    or new.provider is distinct from old.provider
    or new.provider_payment_id is distinct from old.provider_payment_id
  ) then
    raise exception 'PAYMENT_IDENTITY_IMMUTABLE_AFTER_SUCCESS';
  end if;
  if coalesce(new.refunded_amount, 0) < coalesce(old.refunded_amount, 0) and not v_refund_failure then
    raise exception 'PAYMENT_REFUNDED_AMOUNT_CANNOT_DECREASE';
  end if;
  if v_new = 'REFUNDED' and coalesce(new.refunded_amount, 0) <> new.amount then
    raise exception 'REFUNDED_PAYMENT_REQUIRES_FULL_AMOUNT';
  end if;
  if v_new = 'SUCCEEDED' and coalesce(new.refunded_amount, 0) <> 0 then
    raise exception 'REFUNDED_PAYMENT_CANNOT_SUCCEED';
  end if;
  if v_old = v_new then
    if v_old = 'PARTIAL_REFUND'
       and new.refunded_amount is distinct from old.refunded_amount
       and coalesce(new.refunded_amount, 0) <= coalesce(old.refunded_amount, 0)
       and not v_refund_failure then
      raise exception 'PARTIAL_REFUND_AMOUNT_MUST_INCREASE';
    end if;
    return new;
  end if;
  if (v_old in ('INITIATED', 'PENDING') and v_new in ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED'))
     or (v_old = 'SUCCEEDED' and v_new in ('PARTIAL_REFUND', 'REFUNDED'))
     or (v_old = 'PARTIAL_REFUND' and v_new = 'REFUNDED')
     or (v_old = 'FAILED' and v_new = 'SUCCEEDED' and v_late_success)
     or (v_refund_failure and v_old = 'REFUNDED' and v_new in ('SUCCEEDED', 'PARTIAL_REFUND'))
     or (v_refund_failure and v_old = 'PARTIAL_REFUND' and v_new = 'SUCCEEDED') then
    return new;
  end if;
  raise exception 'ILLEGAL_PAYMENT_STATUS_TRANSITION:%->%', v_old, v_new;
end;
$$;

create or replace function public.reconcile_failed_order_payment_refund(
  p_payment_id uuid,
  p_provider_refund_id text,
  p_failure_evidence jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.order_payments%rowtype;
  v_refund public.order_payment_provider_refunds%rowtype;
  v_confirmed_total integer;
  v_confirmed_count integer;
  v_next_status public.order_payment_status;
begin
  if p_payment_id is null
     or nullif(btrim(coalesce(p_provider_refund_id, '')), '') is null
     or nullif(btrim(coalesce(p_failure_evidence->>'failure_reason', '')), '') is null then
    raise exception 'REFUND_FAILURE_EVIDENCE_INVALID';
  end if;
  select * into v_payment from public.order_payments
  where id = p_payment_id for update;
  if v_payment.id is null then raise exception 'PAYMENT_NOT_FOUND'; end if;
  select * into v_refund from public.order_payment_provider_refunds
  where payment_id = v_payment.id and provider_refund_id = p_provider_refund_id
  for update;
  if v_refund.id is null or v_refund.status <> 'CONFIRMED' then
    raise exception 'CONFIRMED_REFUND_ROW_NOT_FOUND';
  end if;

  update public.order_payment_provider_refunds set
    status = 'FAILED',
    provider_response = coalesce(provider_response, '{}'::jsonb)
      || jsonb_build_object('failure_evidence', p_failure_evidence),
    updated_at = now()
  where id = v_refund.id;

  select coalesce(sum(amount), 0)::integer, count(*)::integer
  into v_confirmed_total, v_confirmed_count
  from public.order_payment_provider_refunds
  where payment_id = v_payment.id and status = 'CONFIRMED';
  if v_confirmed_total < 0 or v_confirmed_total > v_payment.amount then
    raise exception 'REFUND_FAILURE_AGGREGATE_INVALID';
  end if;
  v_next_status := case
    when v_confirmed_total = 0 then 'SUCCEEDED'::public.order_payment_status
    when v_confirmed_total = v_payment.amount then 'REFUNDED'::public.order_payment_status
    else 'PARTIAL_REFUND'::public.order_payment_status
  end;

  perform set_config('drape.payment_refund_failure', 'evidenced', true);
  update public.order_payments set
    refunded_amount = v_confirmed_total,
    partial_refund_count = v_confirmed_count,
    status = v_next_status,
    refunded_at = case when v_next_status = 'REFUNDED' then refunded_at else null end,
    provider_response = coalesce(provider_response, '{}'::jsonb)
      || jsonb_build_object('failed_refund_reconciliation', jsonb_build_object(
        'provider_refund_id', p_provider_refund_id,
        'amount_reversed', v_refund.amount,
        'evidence', p_failure_evidence
      ))
  where id = v_payment.id
  returning * into v_payment;
  perform set_config('drape.payment_refund_failure', '', true);
  return to_jsonb(v_payment);
exception when others then
  perform set_config('drape.payment_refund_failure', '', true);
  raise;
end;
$$;

revoke all on function public.reconcile_failed_order_payment_refund(uuid, text, jsonb)
from public, anon, authenticated;
grant execute on function public.reconcile_failed_order_payment_refund(uuid, text, jsonb)
to service_role;

create or replace function public.record_bachs_payment_refund_attempt_outcome(
  p_attempt_id uuid,
  p_next_status text,
  p_provider_refund_id text,
  p_provider_evidence jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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
  select * into v_attempt from public.order_payment_refund_attempts
    where id = p_attempt_id for update;
  if v_claim.provider <> 'BACHS' then
    return jsonb_build_object('outcome', 'PROVIDER_MISMATCH');
  end if;
  if v_attempt.provider_refund_id is not null
    and nullif(btrim(p_provider_refund_id), '') is not null
    and v_attempt.provider_refund_id <> nullif(btrim(p_provider_refund_id), '') then
    return jsonb_build_object('outcome', 'IDENTITY_CONFLICT');
  end if;
  if (v_attempt.status = 'SUCCEEDED' and p_next_status <> 'SUCCEEDED')
    or (v_attempt.status = 'FAILED_RECONCILED'
      and p_next_status not in ('FAILED_RECONCILED', 'SUCCEEDED')) then
    return jsonb_build_object('outcome', 'TERMINAL_CONFLICT');
  end if;
  if v_attempt.status = p_next_status
    and (nullif(btrim(p_provider_refund_id), '') is null
      or v_attempt.provider_refund_id = nullif(btrim(p_provider_refund_id), '')) then
    return jsonb_build_object(
      'outcome', 'EXISTING', 'claim_id', v_claim.id,
      'attempt_id', v_attempt.id, 'status', v_attempt.status,
      'provider_refund_id', v_attempt.provider_refund_id
    );
  end if;

  update public.order_payment_refund_attempts set
    status = p_next_status,
    provider_refund_id = coalesce(provider_refund_id, nullif(btrim(p_provider_refund_id), '')),
    provider_evidence = p_provider_evidence,
    updated_at = now()
  where id = p_attempt_id returning * into v_attempt;

  if p_next_status = 'SUCCEEDED' then
    if v_claim.status = 'SUCCEEDED'
       and v_claim.provider_refund_id is distinct from v_attempt.provider_refund_id then
      v_result := 'SECOND_SUCCESS_NEEDS_OPS';
    elsif v_claim.status = 'FAILED_RECONCILED' then
      v_result := 'LATE_SUCCESS';
    end if;
    v_claim_status := 'SUCCEEDED';
  elsif p_next_status = 'FAILED_RECONCILED' then
    v_claim_status := 'FAILED_RECONCILED';
  elsif v_claim.status in ('FAILED_RECONCILED', 'SUCCEEDED') then
    v_claim_status := v_claim.status;
  else
    v_claim_status := p_next_status;
  end if;

  if v_claim_status <> v_claim.status then
    update public.order_payment_refund_claims set
      status = v_claim_status,
      provider_refund_id = case when v_claim_status = 'SUCCEEDED'
        then coalesce(provider_refund_id, v_attempt.provider_refund_id)
        else provider_refund_id end,
      provider_evidence = p_provider_evidence,
      refund_context = coalesce(refund_context, jsonb_build_object(
        'provider', 'BACHS', 'attempt_id', v_attempt.id,
        'provider_reference', v_attempt.provider_reference
      )),
      updated_at = now()
    where id = v_claim.id;
  end if;

  if p_next_status = 'SUCCEEDED' then
    perform public.record_confirmed_order_payment_refund(
      v_claim.payment_id,
      v_attempt.provider_refund_id,
      v_claim.refund_amount,
      p_provider_evidence || jsonb_build_object(
        'source', 'record_bachs_payment_refund_attempt_outcome',
        'refund_claim_id', v_claim.id,
        'refund_attempt_id', v_attempt.id
      )
    );
  end if;

  return jsonb_build_object(
    'outcome', v_result, 'claim_id', v_claim.id,
    'attempt_id', v_attempt.id, 'status', v_attempt.status,
    'provider_refund_id', v_attempt.provider_refund_id,
    'claim_status', v_claim_status
  );
end;
$$;

revoke all on function public.record_bachs_payment_refund_attempt_outcome(uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.record_bachs_payment_refund_attempt_outcome(uuid, text, text, jsonb)
to service_role;

create or replace function public.reserve_payment_late_success_refund(
  p_payment_id uuid,
  p_provider_event_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.order_payments%rowtype;
  v_operation public.payment_late_success_refund_operations%rowtype;
  v_has_newer boolean;
begin
  select * into v_payment from public.order_payments
  where id = p_payment_id for update;
  select exists (
    select 1 from public.order_payments newer
    where newer.order_id = v_payment.order_id
      and newer.phase = v_payment.phase
      and newer.provider = v_payment.provider
      and newer.created_at > v_payment.created_at
      and newer.id <> v_payment.id
  ) into v_has_newer;
  if v_payment.id is null
     or (v_payment.status::text <> 'CANCELED'
       and not (coalesce(v_payment.provider_response, '{}'::jsonb) ? 'superseded_at')
       and not (coalesce(v_payment.provider_response, '{}'::jsonb) ? 'superseded_by_idempotency_key')
       and not v_has_newer)
     or nullif(btrim(coalesce(p_provider_event_id, '')), '') is null
     or nullif(btrim(coalesce(v_payment.provider_payment_id, '')), '') is null then
    raise exception 'LATE_SUCCESS_REFUND_NOT_ELIGIBLE';
  end if;
  insert into public.payment_late_success_refund_operations (
    payment_id, provider, provider_payment_id, amount, currency,
    provider_event_id, idempotency_key
  ) values (
    v_payment.id, v_payment.provider, v_payment.provider_payment_id,
    v_payment.amount, v_payment.currency, p_provider_event_id,
    'PAY003-LATE-SUCCESS-REFUND-' || v_payment.id::text
  ) on conflict (payment_id) do nothing;
  select * into v_operation from public.payment_late_success_refund_operations
  where payment_id = v_payment.id for update;
  return to_jsonb(v_operation);
end;
$$;

create or replace function public.apply_order_payment_status_transition(
  p_provider public.payment_provider,
  p_provider_payment_id text,
  p_status public.order_payment_status,
  p_provider_response jsonb default '{}'::jsonb,
  p_provider_event_id text default null,
  p_allow_evidenced_late_success boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.order_payments%rowtype;
  v_from text;
  v_to text := p_status::text;
  v_allowed boolean := false;
  v_event_id text;
  v_superseded boolean := false;
  v_has_newer boolean := false;
  v_audit_id uuid;
begin
  select * into v_payment from public.order_payments
  where provider = p_provider and provider_payment_id = p_provider_payment_id
  for update;
  if v_payment.id is null then
    return jsonb_build_object(
      'payment', null, 'transitioned', false,
      'fromStatus', null, 'toStatus', v_to
    );
  end if;
  v_from := v_payment.status::text;
  v_event_id := coalesce(
    nullif(btrim(p_provider_event_id), ''),
    nullif(btrim(p_provider_response->>'id'), ''),
    'unknown'
  );
  v_superseded := coalesce(v_payment.provider_response ? 'superseded_at', false)
    or coalesce(v_payment.provider_response ? 'superseded_by_idempotency_key', false);
  select exists (
    select 1 from public.order_payments newer
    where newer.order_id = v_payment.order_id
      and newer.phase = v_payment.phase
      and newer.provider = v_payment.provider
      and newer.created_at > v_payment.created_at
      and newer.id <> v_payment.id
  ) into v_has_newer;

  if v_from = v_to then
    v_allowed := false;
  elsif v_from in ('INITIATED', 'PENDING')
      and v_to in ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED') then
    v_allowed := true;
  elsif v_from = 'FAILED' and v_to = 'SUCCEEDED'
      and p_allow_evidenced_late_success
      and v_event_id <> 'unknown'
      and not v_superseded
      and not v_has_newer
      and coalesce(v_payment.refunded_amount, 0) = 0 then
    v_allowed := true;
    perform set_config('drape.payment_late_success', 'evidenced', true);
  end if;

  if v_allowed then
    update public.order_payments set
      status = p_status,
      provider_response = coalesce(provider_response, '{}'::jsonb)
        || coalesce(p_provider_response, '{}'::jsonb),
      confirmed_at = case when v_to = 'SUCCEEDED'
        then coalesce(confirmed_at, now()) else confirmed_at end,
      failed_at = case when v_to in ('FAILED', 'CANCELED')
        then coalesce(failed_at, now()) else failed_at end
    where id = v_payment.id
    returning * into v_payment;
    perform set_config('drape.payment_late_success', '', true);
    return jsonb_build_object(
      'payment', to_jsonb(v_payment), 'transitioned', true,
      'fromStatus', v_from, 'toStatus', v_to
    );
  end if;

  insert into public.payment_status_transition_audits (
    payment_id, provider, provider_event_id, from_status, to_status, payload
  ) values (
    v_payment.id, v_payment.provider, v_event_id,
    v_payment.status, p_status,
    jsonb_build_object(
      'provider_payment_id', v_payment.provider_payment_id,
      'superseded', v_superseded,
      'newer_attempt_exists', v_has_newer
    )
  ) on conflict (payment_id, provider_event_id, from_status, to_status) do nothing
  returning id into v_audit_id;
  if v_audit_id is not null then
    insert into public.audit_logs (actor_role, order_id, event, severity, payload)
    values (
      'SYSTEM', case
        when v_payment.order_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then v_payment.order_id::uuid else null end,
      'payment.stale_status_ignored', 'warn',
      jsonb_build_object(
        'payment_id', v_payment.id,
        'provider', v_payment.provider,
        'provider_payment_id', v_payment.provider_payment_id,
        'provider_event_id', v_event_id,
        'from_status', v_from,
        'to_status', v_to
      )
    );
  end if;
  perform set_config('drape.payment_late_success', '', true);
  return jsonb_build_object(
    'payment', to_jsonb(v_payment), 'transitioned', false,
    'fromStatus', v_from, 'toStatus', v_to
  );
exception when others then
  perform set_config('drape.payment_late_success', '', true);
  raise;
end;
$$;

revoke all on function public.reserve_payment_late_success_refund(uuid, text)
from public, anon, authenticated;
grant execute on function public.reserve_payment_late_success_refund(uuid, text)
to service_role;
revoke all on function public.apply_order_payment_status_transition(
  public.payment_provider, text, public.order_payment_status, jsonb, text, boolean
) from public, anon, authenticated;
grant execute on function public.apply_order_payment_status_transition(
  public.payment_provider, text, public.order_payment_status, jsonb, text, boolean
) to service_role;

