-- PAY-003: payment outcomes are monotonic and stale provider events are inert.

create table if not exists public.payment_status_transition_audits (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.order_payments(id) on delete restrict,
  provider public.payment_provider not null,
  provider_event_id text not null,
  from_status public.order_payment_status not null,
  to_status public.order_payment_status not null,
  event text not null default 'payment.stale_status_ignored'
    check (event = 'payment.stale_status_ignored'),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (payment_id, provider_event_id, from_status, to_status)
);

alter table public.payment_status_transition_audits enable row level security;
revoke all on public.payment_status_transition_audits from public, anon, authenticated;
grant select, insert on public.payment_status_transition_audits to service_role;

create table if not exists public.order_payment_provider_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.order_payments(id) on delete restrict,
  provider public.payment_provider not null,
  provider_refund_id text not null,
  amount integer not null check (amount > 0),
  status text not null check (status in ('CONFIRMED', 'FAILED')),
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_refund_id)
);

create index if not exists order_payment_provider_refunds_payment_idx
  on public.order_payment_provider_refunds(payment_id, status, created_at);
alter table public.order_payment_provider_refunds enable row level security;
revoke all on public.order_payment_provider_refunds from public, anon, authenticated;
grant select, insert, update on public.order_payment_provider_refunds to service_role;

create table if not exists public.payment_late_success_refund_operations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.order_payments(id) on delete restrict,
  provider public.payment_provider not null,
  provider_payment_id text not null,
  amount integer not null check (amount > 0),
  currency public.currency not null,
  provider_event_id text not null,
  idempotency_key text not null unique,
  status text not null default 'RESERVED'
    check (status in ('RESERVED', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED')),
  provider_refund_id text,
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payment_late_success_refund_operations enable row level security;
revoke all on public.payment_late_success_refund_operations from public, anon, authenticated;
grant select, insert, update on public.payment_late_success_refund_operations to service_role;

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
begin
  select * into v_payment from public.order_payments where id = p_payment_id for update;
  if v_payment.id is null
     or (v_payment.status::text <> 'CANCELED'
       and not (coalesce(v_payment.provider_response, '{}'::jsonb) ? 'superseded_at')
       and not (coalesce(v_payment.provider_response, '{}'::jsonb) ? 'superseded_by_idempotency_key'))
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

create or replace function public.record_payment_late_success_refund_outcome(
  p_operation_id uuid,
  p_status text,
  p_provider_refund_id text,
  p_provider_response jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.payment_late_success_refund_operations%rowtype;
begin
  if p_status not in ('PROVIDER_PENDING', 'SUCCEEDED', 'FAILED') then
    raise exception 'LATE_SUCCESS_REFUND_STATUS_INVALID';
  end if;
  select * into v_operation from public.payment_late_success_refund_operations
  where id = p_operation_id for update;
  if v_operation.id is null then raise exception 'LATE_SUCCESS_REFUND_OPERATION_NOT_FOUND'; end if;
  if v_operation.status = 'SUCCEEDED' and p_status <> 'SUCCEEDED' then
    raise exception 'LATE_SUCCESS_REFUND_OUTCOME_TERMINAL';
  end if;
  update public.payment_late_success_refund_operations set
    status = p_status,
    provider_refund_id = coalesce(provider_refund_id, p_provider_refund_id),
    provider_response = coalesce(p_provider_response, '{}'::jsonb),
    updated_at = now()
  where id = v_operation.id
    and (provider_refund_id is null or provider_refund_id = p_provider_refund_id)
  returning * into v_operation;
  if not found then raise exception 'LATE_SUCCESS_REFUND_IDENTITY_CONFLICT'; end if;
  return to_jsonb(v_operation);
end;
$$;

revoke all on function public.reserve_payment_late_success_refund(uuid, text)
from public, anon, authenticated;
revoke all on function public.record_payment_late_success_refund_outcome(uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.reserve_payment_late_success_refund(uuid, text) to service_role;
grant execute on function public.record_payment_late_success_refund_outcome(uuid, text, text, jsonb) to service_role;

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
    then
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

revoke all on function public.guard_order_payment_forward_status() from public, anon, authenticated, service_role;

drop trigger if exists order_payment_forward_status_guard on public.order_payments;
create trigger order_payment_forward_status_guard
before update on public.order_payments
for each row execute function public.guard_order_payment_forward_status();

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
  select * into v_payment
  from public.order_payments
  where provider = p_provider and provider_payment_id = p_provider_payment_id
  for update;

  if v_payment.id is null then
    return jsonb_build_object(
      'payment', null, 'transitioned', false, 'fromStatus', null, 'toStatus', v_to
    );
  end if;

  v_from := v_payment.status::text;
  v_event_id := coalesce(nullif(btrim(p_provider_event_id), ''), nullif(btrim(p_provider_response->>'id'), ''), 'unknown');
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
  elsif v_from in ('INITIATED', 'PENDING') and v_to in ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED') then
    v_allowed := true;
  elsif v_from = 'FAILED' and v_to = 'SUCCEEDED'
      and p_allow_evidenced_late_success
      and v_event_id <> 'unknown'
      and not v_superseded
      and not v_has_newer
      and coalesce(v_payment.refunded_amount, 0) = 0 then
    v_allowed := true;
    perform set_config('drape.payment_late_success', 'evidenced', true);
  elsif v_from = 'SUCCEEDED' and v_to in ('PARTIAL_REFUND', 'REFUNDED') then
    -- Refund state is written by the exact refund RPC, not this status-only RPC.
    v_allowed := false;
  else
    v_allowed := false;
  end if;

  if v_allowed then
    update public.order_payments set
      status = p_status,
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      confirmed_at = case when v_to = 'SUCCEEDED' then coalesce(confirmed_at, now()) else confirmed_at end,
      failed_at = case when v_to in ('FAILED', 'CANCELED') then coalesce(failed_at, now()) else failed_at end
    where id = v_payment.id
    returning * into v_payment;

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
  )
  on conflict (payment_id, provider_event_id, from_status, to_status) do nothing
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

  return jsonb_build_object(
    'payment', to_jsonb(v_payment), 'transitioned', false,
    'fromStatus', v_from, 'toStatus', v_to
  );
end;
$$;

revoke all on function public.apply_order_payment_status_transition(
  public.payment_provider, text, public.order_payment_status, jsonb, text, boolean
) from public, anon, authenticated;
grant execute on function public.apply_order_payment_status_transition(
  public.payment_provider, text, public.order_payment_status, jsonb, text, boolean
) to service_role;

create or replace function public.guard_order_payment_backed_advancement()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_payment public.order_payments%rowtype;
begin
  if new.stage::text = 'CONFIRMED' and old.stage::text <> 'CONFIRMED' then
    select * into v_payment from public.order_payments
    where order_id::text = new.id::text
      and phase::text = 'INITIAL_ORDER'
      and provider::text = new.payment_provider::text
      and provider_payment_id = new.payment_intent_id
    order by created_at desc limit 1
    for share;
    if v_payment.id is null or v_payment.status::text <> 'SUCCEEDED'
       or coalesce(v_payment.refunded_amount, 0) <> 0 then
      raise exception 'ORDER_ADVANCEMENT_REQUIRES_CURRENT_SUCCEEDED_PAYMENT';
    end if;
  end if;

  if new.fulfillment_payment_paid_at is not null
     and old.fulfillment_payment_paid_at is null then
    select * into v_payment from public.order_payments
    where order_id::text = new.id::text
      and phase::text = 'FULFILLMENT'
      and provider::text = new.fulfillment_payment_provider::text
      and provider_payment_id = new.fulfillment_payment_intent_id
    order by created_at desc limit 1
    for share;
    if v_payment.id is null or v_payment.status::text <> 'SUCCEEDED'
       or coalesce(v_payment.refunded_amount, 0) <> 0 then
      raise exception 'FULFILLMENT_ADVANCEMENT_REQUIRES_CURRENT_SUCCEEDED_PAYMENT';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_order_payment_backed_advancement() from public, anon, authenticated, service_role;
drop trigger if exists order_payment_backed_advancement_guard on public.orders;
create trigger order_payment_backed_advancement_guard
before update on public.orders
for each row execute function public.guard_order_payment_backed_advancement();

create or replace function public.reconcile_failed_order_payment_refund(
  p_refund_claim_id uuid,
  p_provider_refund_id text,
  p_failure_evidence jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim public.order_payment_refund_claims%rowtype;
  v_payment public.order_payments%rowtype;
  v_expected integer;
  v_next_status public.order_payment_status;
begin
  select * into v_claim from public.order_payment_refund_claims
  where id = p_refund_claim_id for update;
  if v_claim.id is null
     or v_claim.status <> 'FAILED_RECONCILED'
     or v_claim.provider_refund_id is distinct from p_provider_refund_id
     or nullif(btrim(coalesce(p_failure_evidence->>'failure_reason', '')), '') is null then
    raise exception 'REFUND_FAILURE_EVIDENCE_INVALID';
  end if;

  select * into v_payment from public.order_payments
  where id = v_claim.payment_id for update;
  v_expected := v_claim.refunded_before + v_claim.refund_amount;
  if v_payment.id is null or coalesce(v_payment.refunded_amount, 0) <> v_expected then
    raise exception 'REFUND_FAILURE_POSITION_MISMATCH';
  end if;

  update public.order_payment_provider_refunds set
    status = 'FAILED',
    provider_response = coalesce(provider_response, '{}'::jsonb) || jsonb_build_object(
      'failure_evidence', p_failure_evidence
    ),
    updated_at = now()
  where payment_id = v_payment.id
    and provider_refund_id = p_provider_refund_id
    and amount = v_claim.refund_amount
    and status = 'CONFIRMED';
  if not found then
    raise exception 'CONFIRMED_REFUND_ROW_NOT_FOUND';
  end if;

  v_next_status := case
    when v_claim.refunded_before = 0 then 'SUCCEEDED'::public.order_payment_status
    else 'PARTIAL_REFUND'::public.order_payment_status
  end;
  perform set_config('drape.payment_refund_failure', 'evidenced', true);
  update public.order_payments set
    refunded_amount = v_claim.refunded_before,
    partial_refund_count = (
      select count(*)::integer from public.order_payment_provider_refunds
      where payment_id = v_payment.id and status = 'CONFIRMED'
    ),
    status = v_next_status,
    refunded_at = case when v_next_status::text = 'REFUNDED' then refunded_at else null end,
    provider_response = coalesce(provider_response, '{}'::jsonb) || jsonb_build_object(
      'failed_refund_reconciliation', jsonb_build_object(
        'claim_id', v_claim.id,
        'provider_refund_id', p_provider_refund_id,
        'amount_reversed', v_claim.refund_amount,
        'evidence', p_failure_evidence
      )
    )
  where id = v_payment.id
  returning * into v_payment;

  return to_jsonb(v_payment);
end;
$$;

revoke all on function public.reconcile_failed_order_payment_refund(uuid, text, jsonb)
from public, anon, authenticated;
grant execute on function public.reconcile_failed_order_payment_refund(uuid, text, jsonb)
to service_role;

create or replace function public.record_confirmed_order_payment_refund(
  p_payment_id uuid,
  p_provider_refund_id text,
  p_amount integer,
  p_provider_response jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.order_payments%rowtype;
  v_existing public.order_payment_provider_refunds%rowtype;
  v_total integer;
  v_status public.order_payment_status;
begin
  if nullif(btrim(coalesce(p_provider_refund_id, '')), '') is null or p_amount <= 0 then
    raise exception 'PROVIDER_REFUND_IDENTITY_INVALID';
  end if;
  select * into v_payment from public.order_payments where id = p_payment_id for update;
  if v_payment.id is null or v_payment.status::text not in ('SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED') then
    raise exception 'PAYMENT_NOT_REFUNDABLE';
  end if;

  select * into v_existing from public.order_payment_provider_refunds
  where provider = v_payment.provider and provider_refund_id = p_provider_refund_id
  for update;
  if v_existing.id is not null and (
    v_existing.payment_id <> p_payment_id or v_existing.amount <> p_amount
  ) then
    raise exception 'PROVIDER_REFUND_IDENTITY_CONFLICT';
  end if;
  if v_existing.id is null then
    insert into public.order_payment_provider_refunds (
      payment_id, provider, provider_refund_id, amount, status, provider_response
    ) values (
      p_payment_id, v_payment.provider, p_provider_refund_id, p_amount,
      'CONFIRMED', coalesce(p_provider_response, '{}'::jsonb)
    );
  elsif v_existing.status = 'FAILED' then
    raise exception 'FAILED_PROVIDER_REFUND_CANNOT_CONFIRM_WITHOUT_REVIEW';
  end if;

  select coalesce(sum(amount), 0)::integer into v_total
  from public.order_payment_provider_refunds
  where payment_id = p_payment_id and status = 'CONFIRMED';
  if v_total > v_payment.amount then
    raise exception 'CONFIRMED_REFUNDS_EXCEED_PAYMENT';
  end if;
  v_status := case when v_total = v_payment.amount
    then 'REFUNDED'::public.order_payment_status
    else 'PARTIAL_REFUND'::public.order_payment_status end;

  update public.order_payments set
    status = v_status,
    refunded_amount = v_total,
    partial_refund_count = (
      select count(*)::integer from public.order_payment_provider_refunds
      where payment_id = p_payment_id and status = 'CONFIRMED'
    ),
    last_refund_amount = p_amount,
    last_refund_at = now(),
    refunded_at = case when v_status::text = 'REFUNDED' then coalesce(refunded_at, now()) else null end,
    provider_response = coalesce(provider_response, '{}'::jsonb) || jsonb_build_object(
      'latest_refund', jsonb_build_object(
        'provider_refund_id', p_provider_refund_id,
        'amount', p_amount,
        'response', coalesce(p_provider_response, '{}'::jsonb)
      )
    )
  where id = p_payment_id
  returning * into v_payment;

  return to_jsonb(v_payment);
end;
$$;

revoke all on function public.record_confirmed_order_payment_refund(uuid, text, integer, jsonb)
from public, anon, authenticated;
grant execute on function public.record_confirmed_order_payment_refund(uuid, text, integer, jsonb)
to service_role;

