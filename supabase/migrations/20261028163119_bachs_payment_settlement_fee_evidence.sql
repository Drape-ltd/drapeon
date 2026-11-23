-- Persist post-settlement Bachs fee evidence and recognize the actual provider
-- cost as its own immutable commercial-ledger adjustment. The accepted capture
-- and customer total are never rewritten.

create table public.provider_payment_settlement_checks (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.order_payments(id) on delete restrict,
  order_id text not null,
  provider payment_provider not null default 'BACHS' check (provider = 'BACHS'),
  provider_checkout_id text not null check (provider_checkout_id like 'chk_%'),
  provider_charge_id text not null unique check (provider_charge_id like 'ch_%'),
  provider_reference text not null check (length(provider_reference) between 1 and 255),
  currency currency not null,
  gross_amount integer not null check (gross_amount > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'SETTLED', 'REVIEW')),
  check_count integer not null default 0 check (check_count >= 0),
  last_checked_at timestamptz,
  next_check_at timestamptz not null default now(),
  review_reason text,
  fee_amount integer check (fee_amount is null or fee_amount >= 0),
  fee_currency currency,
  fee_paid_by text check (fee_paid_by is null or fee_paid_by in ('merchant', 'platform')),
  provider_updated_at timestamptz,
  provider_completed_at timestamptz,
  fee_ledger_transaction_id uuid unique references public.commercial_ledger_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'PENDING' and fee_amount is null and fee_currency is null and fee_paid_by is null and fee_ledger_transaction_id is null)
    or (status = 'REVIEW' and review_reason is not null)
    or (status = 'SETTLED' and fee_amount is not null and fee_currency = currency and fee_paid_by is not null
      and ((fee_amount = 0 and fee_ledger_transaction_id is null) or (fee_amount > 0 and fee_ledger_transaction_id is not null)))
  )
);

create index provider_payment_settlement_checks_due_idx
  on public.provider_payment_settlement_checks(next_check_at, created_at)
  where status = 'PENDING';

alter table public.provider_payment_settlement_checks enable row level security;
revoke all on public.provider_payment_settlement_checks from public, anon, authenticated;
grant select on public.provider_payment_settlement_checks to service_role;

comment on table public.provider_payment_settlement_checks is
  'Service-only Bachs post-settlement fee reconciliation state. Successful settlement evidence is immutable after SETTLED; pending reads use bounded backoff.';
comment on column public.provider_payment_settlement_checks.fee_paid_by is
  'Bachs-reported settlement outcome (merchant or platform); never inferred from the configured collector or a published fee rate.';

create function public.guard_provider_payment_settlement_check()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'PENDING' or new.check_count <> 0 or new.fee_amount is not null then
      raise exception 'A Bachs settlement check must begin pending';
    end if;
    return new;
  end if;

  if new.payment_id is distinct from old.payment_id
    or new.order_id is distinct from old.order_id
    or new.provider is distinct from old.provider
    or new.provider_checkout_id is distinct from old.provider_checkout_id
    or new.provider_charge_id is distinct from old.provider_charge_id
    or new.provider_reference is distinct from old.provider_reference
    or new.currency is distinct from old.currency
    or new.gross_amount is distinct from old.gross_amount
    or new.created_at is distinct from old.created_at then
    raise exception 'Bachs settlement check identity is immutable';
  end if;
  if new.check_count < old.check_count then
    raise exception 'Bachs settlement check count cannot move backwards';
  end if;
  if old.status = 'SETTLED' and new is distinct from old then
    raise exception 'Settled Bachs fee evidence is immutable';
  end if;
  if old.status = 'REVIEW' and new.status <> 'REVIEW' then
    raise exception 'A reviewed Bachs settlement requires an audited Ops resolution';
  end if;
  if old.status = 'PENDING' and new.status not in ('PENDING', 'SETTLED', 'REVIEW') then
    raise exception 'Invalid Bachs settlement state transition';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_provider_payment_settlement_check() from public, anon, authenticated;
create trigger provider_payment_settlement_check_guard
  before insert or update on public.provider_payment_settlement_checks
  for each row execute function public.guard_provider_payment_settlement_check();

create function public.register_bachs_payment_settlement_check(
  p_payment_id uuid,
  p_provider_checkout_id text,
  p_provider_charge_id text
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
  if p_payment_id is null or p_provider_checkout_id !~ '^chk_[A-Za-z0-9_-]+$'
    or p_provider_charge_id !~ '^ch_[A-Za-z0-9_-]+$' then
    raise exception 'Invalid Bachs settlement identity';
  end if;

  select * into v_payment from public.order_payments where id = p_payment_id for update;
  if not found or v_payment.provider <> 'BACHS' or v_payment.status <> 'SUCCEEDED'
    or v_payment.provider_payment_id is distinct from p_provider_checkout_id
    or v_payment.provider_charge_id is distinct from p_provider_charge_id then
    raise exception 'Bachs settlement identity does not match a succeeded payment attempt';
  end if;

  insert into public.provider_payment_settlement_checks (
    payment_id, order_id, provider, provider_checkout_id, provider_charge_id,
    provider_reference, currency, gross_amount
  ) values (
    v_payment.id, v_payment.order_id::text, 'BACHS', p_provider_checkout_id,
    p_provider_charge_id, v_payment.idempotency_key, v_payment.currency, v_payment.amount
  ) on conflict (payment_id) do nothing;

  select * into v_check from public.provider_payment_settlement_checks
    where payment_id = p_payment_id for update;
  if v_check.provider_checkout_id is distinct from p_provider_checkout_id
    or v_check.provider_charge_id is distinct from p_provider_charge_id
    or v_check.provider_reference is distinct from v_payment.idempotency_key
    or v_check.currency is distinct from v_payment.currency
    or v_check.gross_amount is distinct from v_payment.amount then
    raise exception 'Existing Bachs settlement check conflicts with the payment attempt';
  end if;

  return jsonb_build_object(
    'outcome', 'REGISTERED', 'payment_id', v_check.payment_id,
    'status', v_check.status, 'next_check_at', v_check.next_check_at
  );
end;
$$;

create function public.claim_bachs_payment_settlement_check(p_payment_id uuid)
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
    'check_count', v_check.check_count
  );
end;
$$;

create function public.record_bachs_payment_settlement_check(
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
  v_payment public.order_payments%rowtype;
  v_ledger_id uuid;
  v_policy_version text;
  v_pricing_version integer;
  v_correlation_id uuid;
  v_entries jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  select * into v_check from public.provider_payment_settlement_checks
    where payment_id = p_payment_id for update;
  if not found then raise exception 'Bachs settlement check was not registered'; end if;
  if v_check.status = 'SETTLED' then
    if p_outcome = 'SETTLED' and p_fee_amount is not distinct from v_check.fee_amount
      and p_fee_currency is not distinct from v_check.fee_currency
      and p_fee_paid_by is not distinct from v_check.fee_paid_by then
      return jsonb_build_object('outcome', 'ALREADY_SETTLED', 'payment_id', p_payment_id,
        'fee_ledger_transaction_id', v_check.fee_ledger_transaction_id);
    end if;
    return jsonb_build_object('outcome', 'SETTLED_CONFLICT', 'payment_id', p_payment_id);
  end if;
  if v_check.status = 'REVIEW' then
    return jsonb_build_object('outcome', 'REVIEW', 'payment_id', p_payment_id,
      'reason', v_check.review_reason);
  end if;

  if p_outcome = 'PENDING' then
    update public.provider_payment_settlement_checks
      set review_reason = null, updated_at = now()
      where payment_id = p_payment_id;
    return jsonb_build_object('outcome', 'PENDING', 'payment_id', p_payment_id,
      'check_count', v_check.check_count, 'next_check_at', v_check.next_check_at);
  end if;
  if p_outcome = 'REVIEW' then
    if nullif(btrim(p_reason), '') is null then raise exception 'Review reason is required'; end if;
    update public.provider_payment_settlement_checks
      set status = 'REVIEW', review_reason = left(p_reason, 100), next_check_at = 'infinity', updated_at = now()
      where payment_id = p_payment_id;
    return jsonb_build_object('outcome', 'REVIEW', 'payment_id', p_payment_id,
      'reason', left(p_reason, 100));
  end if;
  if p_outcome <> 'SETTLED' or p_fee_amount is null or p_fee_amount < 0
    or p_fee_currency is distinct from v_check.currency
    or p_fee_paid_by not in ('merchant', 'platform')
    or p_fee_amount > v_check.gross_amount then
    raise exception 'Invalid Bachs settlement fee evidence';
  end if;

  select * into v_payment from public.order_payments where id = p_payment_id for update;
  if not found or v_payment.provider <> 'BACHS' or v_payment.status <> 'SUCCEEDED'
    or v_payment.provider_payment_id is distinct from v_check.provider_checkout_id
    or v_payment.provider_charge_id is distinct from v_check.provider_charge_id
    or v_payment.currency is distinct from v_check.currency
    or v_payment.amount is distinct from v_check.gross_amount then
    update public.provider_payment_settlement_checks
      set status = 'REVIEW', review_reason = 'payment_attempt_changed', next_check_at = 'infinity', updated_at = now()
      where payment_id = p_payment_id;
    return jsonb_build_object('outcome', 'REVIEW', 'payment_id', p_payment_id,
      'reason', 'payment_attempt_changed');
  end if;

  if p_fee_amount > 0 then
    v_policy_version := coalesce(v_payment.policy_version, 'legacy-single-release-72h');
    v_pricing_version := coalesce(v_payment.pricing_version, 1);
    v_correlation_id := coalesce(v_payment.correlation_id, gen_random_uuid());
    v_entries := jsonb_build_array(
      jsonb_build_object('accountCode', 'PROVIDER_FEE_EXPENSE', 'accountScope', 'BACHS',
        'direction', 'DEBIT', 'amount', p_fee_amount, 'currency', v_check.currency::text),
      jsonb_build_object('accountCode', 'PROVIDER_CLEARING', 'accountScope', 'BACHS',
        'direction', 'CREDIT', 'amount', p_fee_amount, 'currency', v_check.currency::text)
    );
    v_ledger_id := public.post_commercial_ledger_transaction(
      'bachs-provider-fee:' || p_payment_id::text,
      'ADJUSTMENT', 'PROVIDER_FEE_RECOGNITION', v_payment.order_id::text, p_payment_id,
      v_policy_version, v_pricing_version, v_correlation_id, v_check.provider_charge_id,
      v_entries,
      jsonb_build_object('provider', 'BACHS', 'fee_paid_by', p_fee_paid_by,
        'provider_checkout_id', v_check.provider_checkout_id,
        'provider_charge_id', v_check.provider_charge_id,
        'provider_updated_at', p_provider_updated_at,
        'provider_completed_at', p_provider_completed_at),
      null, null, 'SYSTEM', v_check.currency, p_fee_amount, v_check.currency,
      p_fee_amount, 1, p_fee_amount
    );
  end if;

  update public.provider_payment_settlement_checks
    set status = 'SETTLED', review_reason = null, next_check_at = 'infinity',
        fee_amount = p_fee_amount, fee_currency = p_fee_currency, fee_paid_by = p_fee_paid_by,
        provider_updated_at = p_provider_updated_at, provider_completed_at = p_provider_completed_at,
        fee_ledger_transaction_id = v_ledger_id, updated_at = now()
    where payment_id = p_payment_id;
  return jsonb_build_object('outcome', 'SETTLED', 'payment_id', p_payment_id,
    'fee_amount', p_fee_amount, 'fee_paid_by', p_fee_paid_by,
    'fee_ledger_transaction_id', v_ledger_id);
end;
$$;

revoke all on function public.register_bachs_payment_settlement_check(uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_bachs_payment_settlement_check(uuid) from public, anon, authenticated;
revoke all on function public.record_bachs_payment_settlement_check(uuid, text, text, integer, currency, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.register_bachs_payment_settlement_check(uuid, text, text) to service_role;
grant execute on function public.claim_bachs_payment_settlement_check(uuid) to service_role;
grant execute on function public.record_bachs_payment_settlement_check(uuid, text, text, integer, currency, text, timestamptz, timestamptz) to service_role;
