-- Restore the live pre-change functions. Roll back Edge code before this migration.
-- Precondition: zero committed REVERSAL journals with an idempotency key
-- starting `refund-failure-reversal:`. If any exist, the old functions would
-- ignore those reversals and misstate refund allocation/tranche availability.
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

create or replace function payment_internal.tranche_source_payment_available(
  p_payment_id uuid,
  p_plan_id uuid,
  p_tranche_id uuid default null
)
returns boolean
language plpgsql
set search_path = ''
as $function$
declare
  v_payment public.order_payments%rowtype;
  v_plan public.order_settlement_plans%rowtype;
  v_capture_id uuid;
  v_provider_count integer;
  v_provider_amount bigint;
  v_journal_count integer;
  v_journal_amount bigint;
  v_other_claimed bigint;
  v_tranche_amount integer;
begin
  select * into v_payment from public.order_payments where id=p_payment_id;
  select * into v_plan from public.order_settlement_plans where id=p_plan_id;
  if v_payment.id is null or v_plan.id is null
    or v_plan.source_payment_id is distinct from v_payment.id
    or v_plan.order_id is distinct from v_payment.order_id
    or v_plan.currency is distinct from v_payment.currency
    or v_payment.phase <> 'INITIAL_ORDER'
    or v_payment.status not in ('SUCCEEDED','PARTIAL_REFUND')
    or v_payment.ledger_recorded_at is null
    or v_payment.refunded_amount is null
    or v_payment.refunded_amount < 0
    or v_payment.refunded_amount > v_payment.amount then
    return false;
  end if;
  if p_tranche_id is not null then
    select amount into v_tranche_amount from public.order_settlement_tranches
      where id=p_tranche_id and plan_id=p_plan_id;
    if v_tranche_amount is null then return false; end if;
    select coalesce(sum(t.amount),0) into v_other_claimed
      from public.order_settlement_tranches t
      where t.plan_id=p_plan_id and t.id<>p_tranche_id
        and (t.status='RELEASED' or exists (
          select 1 from public.payout_claims c
          where c.business_key='tranche:'||t.id::text
            and c.source_kind='SETTLEMENT_TRANCHE'
        ));
    if v_plan.entitlement_amount - v_other_claimed < v_tranche_amount then
      return false;
    end if;
  end if;

  -- A fee or delivery refund may use the same captured charge, but it may
  -- not consume the subtotal reserved for tailor work and fabric.
  if v_payment.amount::bigint - v_payment.refunded_amount < greatest(
      v_plan.seller_subtotal_amount::bigint,
      v_plan.entitlement_amount::bigint + v_plan.excluded_fabric_allowance_amount
    ) then
    return false;
  end if;
  select id into v_capture_id from public.commercial_ledger_transactions
    where payment_id=p_payment_id and order_id=v_plan.order_id
      and transaction_kind='CAPTURE' and purpose='INITIAL_ORDER';
  if v_capture_id is null or (
    select count(*) from public.commercial_ledger_transactions
    where payment_id=p_payment_id and order_id=v_plan.order_id
      and transaction_kind='CAPTURE' and purpose='INITIAL_ORDER'
  )<>1 then return false; end if;

  select count(*),coalesce(sum(amount),0)
    into v_provider_count,v_provider_amount
    from public.order_payment_provider_refunds
    where payment_id=p_payment_id and status='CONFIRMED';
  select count(*),coalesce(sum(original_amount),0)
    into v_journal_count,v_journal_amount
    from public.commercial_ledger_transactions
    where payment_id=p_payment_id and transaction_kind='REFUND';
  if v_provider_count<>v_journal_count
    or v_provider_amount<>v_journal_amount
    or v_provider_amount<>v_payment.refunded_amount
    or (v_payment.refunded_amount=0 and v_payment.status<>'SUCCEEDED')
    or (v_payment.refunded_amount>0 and v_payment.status<>'PARTIAL_REFUND') then
    return false;
  end if;
  if v_payment.refunded_amount=0 then return true; end if;

  -- Match every confirmed provider refund to one exact journal, and every
  -- journal back to one provider refund. A missing or duplicate receipt
  -- cannot be treated as a harmless non-tailor refund.
  if exists (
    select 1 from public.order_payment_provider_refunds r
    where r.payment_id=p_payment_id and r.status='CONFIRMED'
      and (r.provider is distinct from v_payment.provider
        or (select count(*) from public.commercial_ledger_transactions l
        where l.payment_id=p_payment_id and l.transaction_kind='REFUND'
          and l.provider_reference=r.provider_refund_id
          and l.original_amount=r.amount and l.settlement_amount=r.amount
          and l.original_currency=v_payment.currency
          and l.settlement_currency=v_payment.currency
          and l.reversal_of_transaction_id=v_capture_id)<>1)
  ) or exists (
    select 1 from public.commercial_ledger_transactions l
    where l.payment_id=p_payment_id and l.transaction_kind='REFUND'
      and (l.order_id is distinct from v_plan.order_id
        or l.original_currency is distinct from v_payment.currency
        or l.settlement_currency is distinct from v_payment.currency
        or l.reversal_of_transaction_id is distinct from v_capture_id
        or l.original_amount is distinct from l.settlement_amount
        or l.original_amount<=0
        or (select count(*) from public.order_payment_provider_refunds r
          where r.payment_id=p_payment_id and r.status='CONFIRMED'
            and r.provider=v_payment.provider
            and r.provider_refund_id=l.provider_reference
            and r.amount=l.original_amount)<>1)
  ) then
    return false;
  end if;

  -- The exact journal must reverse only fulfillment, tax, duty or platform
  -- fee liabilities. Tailor entitlement/eligibility and unclassified debits
  -- are never available for a routine tranche release.
  if exists (
    select 1 from public.commercial_ledger_transactions l
    where l.payment_id=p_payment_id and l.transaction_kind='REFUND'
      and (exists (
        select 1 from public.commercial_ledger_entries e
        where e.transaction_id=l.id
          and (e.currency is distinct from v_payment.currency
            or not ((e.direction='DEBIT' and e.account_code in (
              'FULFILLMENT_LIABILITY','TAX_LIABILITY',
              'IMPORT_TAX_LIABILITY','DUTY_LIABILITY','DRAPEON_REVENUE'))
              or (e.direction='CREDIT' and e.account_code='PROVIDER_CLEARING')))
      ) or (select coalesce(sum(e.amount),0) from public.commercial_ledger_entries e
        where e.transaction_id=l.id and e.direction='DEBIT')<>l.original_amount
        or (select coalesce(sum(e.amount),0) from public.commercial_ledger_entries e
        where e.transaction_id=l.id and e.direction='CREDIT')<>l.original_amount)
  ) then
    return false;
  end if;
  return true;
end $function$;
