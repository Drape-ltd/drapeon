-- Dev recorded this migration as version 20261028163827.
-- Keep the signed collection event's reported settlement net and fee beside
-- the immutable payment attempt. The later GET verifies fee identity/payer;
-- both sources must agree before fee recognition is finalized.

alter table public.provider_payment_settlement_checks
  add column provider_webhook_event_id text
    check (provider_webhook_event_id is null or provider_webhook_event_id ~ '^evt_[A-Za-z0-9_-]+$'),
  add column settlement_amount integer
    check (settlement_amount is null or settlement_amount between 0 and gross_amount),
  add column settlement_currency currency,
  add column event_processing_fee_amount integer
    check (event_processing_fee_amount is null or event_processing_fee_amount between 0 and gross_amount),
  add column event_processing_fee_currency currency;

create unique index provider_payment_settlement_checks_event_id_uidx
  on public.provider_payment_settlement_checks(provider_webhook_event_id)
  where provider_webhook_event_id is not null;

alter table public.provider_payment_settlement_checks
  add constraint provider_payment_settlement_final_net_evidence_check check (
    status <> 'SETTLED' or (
      provider_webhook_event_id is not null
      and settlement_amount is not null
      and settlement_currency = currency
      and event_processing_fee_amount is not null
      and event_processing_fee_currency = currency
      and fee_amount = event_processing_fee_amount
      and fee_currency = event_processing_fee_currency
    )
  );

comment on column public.provider_payment_settlement_checks.settlement_amount is
  'Minor units reported by the signed collection.succeeded event; retained as provider evidence, not recomputed from a fee-rate guess.';

create function public.record_bachs_payment_settlement_event_evidence(
  p_payment_id uuid,
  p_provider_event_id text,
  p_settlement_amount integer default null,
  p_settlement_currency currency default null,
  p_processing_fee_amount integer default null,
  p_processing_fee_currency currency default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.order_payments%rowtype;
  v_check public.provider_payment_settlement_checks%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_payment_id is null or p_provider_event_id !~ '^evt_[A-Za-z0-9_-]+$'
    or (p_settlement_amount is not null and (p_settlement_amount < 0 or p_settlement_currency is distinct from (select currency from public.order_payments where id = p_payment_id)))
    or (p_processing_fee_amount is not null and (p_processing_fee_amount < 0 or p_processing_fee_currency is distinct from (select currency from public.order_payments where id = p_payment_id))) then
    raise exception 'Invalid Bachs settlement event evidence';
  end if;

  select * into v_payment from public.order_payments where id = p_payment_id for update;
  if not found or v_payment.provider <> 'BACHS' or v_payment.status <> 'SUCCEEDED' then
    raise exception 'Bachs settlement evidence requires a succeeded Bachs payment';
  end if;
  select * into v_check from public.provider_payment_settlement_checks
    where payment_id = p_payment_id for update;
  if not found or v_check.provider_checkout_id is distinct from v_payment.provider_payment_id
    or v_check.provider_charge_id is distinct from v_payment.provider_charge_id
    or v_check.currency is distinct from v_payment.currency
    or v_check.gross_amount is distinct from v_payment.amount then
    raise exception 'Bachs settlement event does not match its registered payment';
  end if;
  if v_check.status = 'SETTLED' then
    if v_check.provider_webhook_event_id is not distinct from p_provider_event_id
      and v_check.settlement_amount is not distinct from p_settlement_amount
      and v_check.settlement_currency is not distinct from p_settlement_currency
      and v_check.event_processing_fee_amount is not distinct from p_processing_fee_amount
      and v_check.event_processing_fee_currency is not distinct from p_processing_fee_currency then
      return jsonb_build_object('outcome', 'ALREADY_RECORDED', 'payment_id', p_payment_id);
    end if;
    return jsonb_build_object('outcome', 'SETTLED_CONFLICT', 'payment_id', p_payment_id);
  end if;
  if v_check.status = 'REVIEW' then
    return jsonb_build_object('outcome', 'REVIEW', 'payment_id', p_payment_id,
      'reason', v_check.review_reason);
  end if;

  if (v_check.provider_webhook_event_id is not null and v_check.provider_webhook_event_id is distinct from p_provider_event_id)
    or (v_check.settlement_amount is not null and v_check.settlement_amount is distinct from p_settlement_amount)
    or (v_check.settlement_currency is not null and v_check.settlement_currency is distinct from p_settlement_currency)
    or (v_check.event_processing_fee_amount is not null and v_check.event_processing_fee_amount is distinct from p_processing_fee_amount)
    or (v_check.event_processing_fee_currency is not null and v_check.event_processing_fee_currency is distinct from p_processing_fee_currency) then
    update public.provider_payment_settlement_checks
      set status = 'REVIEW', review_reason = 'settlement_event_conflict', next_check_at = 'infinity', updated_at = now()
      where payment_id = p_payment_id;
    return jsonb_build_object('outcome', 'REVIEW', 'payment_id', p_payment_id,
      'reason', 'settlement_event_conflict');
  end if;

  update public.provider_payment_settlement_checks
    set provider_webhook_event_id = coalesce(provider_webhook_event_id, p_provider_event_id),
        settlement_amount = coalesce(settlement_amount, p_settlement_amount),
        settlement_currency = coalesce(settlement_currency, p_settlement_currency),
        event_processing_fee_amount = coalesce(event_processing_fee_amount, p_processing_fee_amount),
        event_processing_fee_currency = coalesce(event_processing_fee_currency, p_processing_fee_currency),
        updated_at = now()
    where payment_id = p_payment_id
    returning * into v_check;

  return jsonb_build_object(
    'outcome', case when v_check.settlement_amount is not null
      and v_check.event_processing_fee_amount is not null then 'RECORDED' else 'INCOMPLETE' end,
    'payment_id', p_payment_id,
    'has_settlement_net', v_check.settlement_amount is not null,
    'has_event_fee', v_check.event_processing_fee_amount is not null
  );
end;
$$;

revoke all on function public.record_bachs_payment_settlement_event_evidence(uuid, text, integer, currency, integer, currency) from public, anon, authenticated;
grant execute on function public.record_bachs_payment_settlement_event_evidence(uuid, text, integer, currency, integer, currency) to service_role;

create or replace function public.claim_bachs_payment_settlement_check(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check public.provider_payment_settlement_checks%rowtype;
  v_lease_minutes integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into v_check from public.provider_payment_settlement_checks
    where payment_id = p_payment_id for update;
  if not found then return jsonb_build_object('outcome', 'NOT_FOUND'); end if;
  if v_check.status <> 'PENDING' then
    return jsonb_build_object('outcome', v_check.status, 'payment_id', v_check.payment_id);
  end if;
  if v_check.next_check_at > now() then
    return jsonb_build_object('outcome', 'WAIT', 'payment_id', v_check.payment_id,
      'next_check_at', v_check.next_check_at);
  end if;

  v_lease_minutes := least(1440, 15 * (2 ^ least(v_check.check_count, 6))::integer);
  update public.provider_payment_settlement_checks
    set check_count = check_count + 1,
        last_checked_at = now(),
        next_check_at = now() + make_interval(mins => v_lease_minutes),
        updated_at = now()
    where payment_id = p_payment_id
    returning * into v_check;
  return jsonb_build_object(
    'outcome', 'CHECK', 'payment_id', v_check.payment_id, 'order_id', v_check.order_id,
    'provider_checkout_id', v_check.provider_checkout_id,
    'provider_charge_id', v_check.provider_charge_id,
    'provider_reference', v_check.provider_reference,
    'currency', v_check.currency, 'gross_amount', v_check.gross_amount,
    'check_count', v_check.check_count,
    'provider_event_id', v_check.provider_webhook_event_id,
    'settlement_amount', v_check.settlement_amount,
    'settlement_currency', v_check.settlement_currency,
    'event_processing_fee_amount', v_check.event_processing_fee_amount,
    'event_processing_fee_currency', v_check.event_processing_fee_currency
  );
end;
$$;
revoke all on function public.claim_bachs_payment_settlement_check(uuid) from public, anon, authenticated;
grant execute on function public.claim_bachs_payment_settlement_check(uuid) to service_role;

-- Keep the original settlement recorder private. The public service-role RPC
-- below is now the only path that can finalize a fee ledger entry, and it first
-- checks the signed event's exact net/fee evidence against the API fee read.
revoke all on function public.record_bachs_payment_settlement_check(uuid, text, text, integer, currency, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

create function public.record_bachs_payment_settlement_check_with_net(
  p_payment_id uuid,
  p_outcome text,
  p_reason text default null,
  p_fee_amount integer default null,
  p_fee_currency currency default null,
  p_fee_paid_by text default null,
  p_provider_updated_at timestamptz default null,
  p_provider_completed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check public.provider_payment_settlement_checks%rowtype;
  v_review_reason text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  if p_outcome = 'SETTLED' then
    select * into v_check from public.provider_payment_settlement_checks
      where payment_id = p_payment_id for update;
    if not found then raise exception 'Bachs settlement check was not registered'; end if;
    if v_check.status = 'PENDING' then
      if v_check.provider_webhook_event_id is null or v_check.settlement_amount is null
        or v_check.settlement_currency is distinct from v_check.currency
        or v_check.event_processing_fee_amount is null
        or v_check.event_processing_fee_currency is distinct from v_check.currency then
        v_review_reason := 'settlement_net_evidence_missing';
      elsif p_fee_amount is distinct from v_check.event_processing_fee_amount
        or p_fee_currency is distinct from v_check.event_processing_fee_currency then
        v_review_reason := 'settlement_fee_event_mismatch';
      end if;
    end if;
    if v_review_reason is not null then
      return public.record_bachs_payment_settlement_check(
        p_payment_id, 'REVIEW', v_review_reason, null, null, null,
        p_provider_updated_at, p_provider_completed_at
      );
    end if;
  end if;

  return public.record_bachs_payment_settlement_check(
    p_payment_id, p_outcome, p_reason, p_fee_amount, p_fee_currency, p_fee_paid_by,
    p_provider_updated_at, p_provider_completed_at
  );
end;
$$;

revoke all on function public.record_bachs_payment_settlement_check_with_net(uuid, text, text, integer, currency, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_bachs_payment_settlement_check_with_net(uuid, text, text, integer, currency, text, timestamptz, timestamptz)
  to service_role;
