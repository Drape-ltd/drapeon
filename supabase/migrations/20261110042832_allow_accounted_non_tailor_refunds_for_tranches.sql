-- A partial refund can coexist with staged tailor earnings only when the
-- provider receipts and immutable refund journals prove it restored money
-- outside the tailor allocation. Unknown or unjournaled refunds fail closed.
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

revoke all on function payment_internal.tranche_source_payment_available(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function payment_internal.tranche_source_payment_available(uuid,uuid,uuid)
  to service_role;


-- The following definitions are copied from live Dev pg_get_functiondef and
-- change only the refund-sensitive predicates. Post-transfer finalizers record
-- a review case if the source changes after provider confirmation.
CREATE OR REPLACE FUNCTION public.guard_tranche_claim_source_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tranche public.order_settlement_tranches%rowtype;
  v_plan public.order_settlement_plans%rowtype;
  v_order public.orders%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_locked text;
begin
  if new.source_kind<>'SETTLEMENT_TRANCHE' then return new; end if;
  select * into v_tranche from public.order_settlement_tranches
    where id::text=new.source_id;
  if not found or v_tranche.status<>'ELIGIBLE'
    or v_tranche.eligible_at is null or v_tranche.eligible_at>now()
    or row(v_tranche.order_id,v_tranche.amount,v_tranche.currency)
       is distinct from row(new.order_id,new.amount,new.currency)
    or new.business_key is distinct from 'tranche:'||v_tranche.id::text
    or new.provider_idempotency_key is distinct from
       'tranche:'||v_tranche.id::text||':op:1' then
    raise exception 'Tranche claim does not match an eligible earning';
  end if;
  select * into v_plan from public.order_settlement_plans
    where id=v_tranche.plan_id;
  select * into v_order from public.orders where id_text=v_tranche.order_id;
  select * into v_profile from public.tailor_profiles
    where id::text=new.tailor_profile_id;
  if v_plan.id is null or v_plan.status<>'ACTIVE'
    or v_order.id is null or v_profile.id is null
    or v_plan.order_id is distinct from v_tranche.order_id
    or v_plan.currency is distinct from v_tranche.currency
    or v_plan.policy_version is distinct from new.earning_policy_version
    or v_order.tailor_id::text is distinct from v_plan.tailor_id::text
    or v_profile.user_id::text is distinct from v_plan.tailor_id::text
    or (v_order.accepted_route_snapshot_at is null
      and (v_profile.payout_account_verified is distinct from true
        or v_profile.payout_reverification_required is true))
    or v_order.tailor_payout_provider_locked::text is distinct from new.provider
    or v_order.tailor_payout_currency_locked is distinct from new.currency then
    raise exception 'Tranche claim does not match its active accepted route';
  end if;
  if v_order.accepted_route_snapshot_at is not null then
    select nullif(btrim(destination.provider_account_ref),'') into v_locked
      from public.payout_destinations destination
      where destination.id=v_order.payout_destination_id
        and destination.tailor_profile_id::text=new.tailor_profile_id
        and destination.provider=new.provider
        and destination.currency=new.currency::text
        and destination.active=true
        and destination.transfers_enabled=true
        and destination.payouts_enabled=true;
  else
    v_locked := case new.provider
      when 'STRIPE' then nullif(btrim(v_order.tailor_stripe_connect_account_id_locked),'')
      when 'PAYSTACK' then nullif(btrim(v_order.tailor_paystack_recipient_code_locked),'')
      else null
    end;
  end if;
  if v_locked is null or v_locked is distinct from new.provider_destination_id then
    raise exception 'Tranche claim destination does not match the accepted order';
  end if;
  if not exists (select 1 from public.order_payments p
      where p.id=v_plan.source_payment_id and p.order_id::text=v_tranche.order_id
        and p.phase='INITIAL_ORDER' and p.status in ('SUCCEEDED','PARTIAL_REFUND')
        and p.ledger_recorded_at is not null
        and payment_internal.tranche_source_payment_available(p.id,v_plan.id,v_tranche.id)
        and p.currency=v_tranche.currency and p.provider::text=new.provider)
    or not exists (select 1 from public.money_desk_requests m
      where m.target_id=v_tranche.id::text and m.order_id=v_tranche.order_id
        and m.action_type='PAYOUT_RELEASE'
        and m.target_type='SETTLEMENT_TRANCHE' and m.status='EXECUTING'
        and m.amount=v_tranche.amount and m.currency=v_tranche.currency
        and m.approval_count>=m.required_approval_count) then
    raise exception 'Tranche claim lacks settled funds or reviewed release authority';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION payment_internal.require_tranche_work_before_provider()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_source_payment_id uuid;
  v_plan_id uuid;
  v_tranche_id uuid;
begin
  if old.source_kind<>'SETTLEMENT_TRANCHE'
    or old.status<>'RESERVED' or new.status<>'PROVIDER_UNKNOWN' then
    return new;
  end if;
  select plan.source_payment_id,plan.id,tr.id
    into v_source_payment_id,v_plan_id,v_tranche_id
    from public.order_settlement_tranches tr
    join public.order_settlement_plans plan on plan.id=tr.plan_id
    where tr.id::text=new.source_id and tr.order_id=new.order_id;
  if v_source_payment_id is null or v_plan_id is null
    or not payment_internal.tranche_source_payment_available(
      v_source_payment_id,v_plan_id,v_tranche_id)
    or exists (select 1 from public.order_payment_refund_claims rc
      where rc.payment_id=v_source_payment_id
        and rc.status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING'))
    or not exists (select 1 from public.order_work_funding_positions pos
      where pos.payout_claim_id=new.id and pos.use_kind='PAYOUT'
        and pos.source_payment_id=v_source_payment_id
        and pos.amount=new.amount and pos.status='RESERVED') then
    raise exception 'Staged payout lacks its exact work funding position; reconcile before provider call';
  end if;
  return new;
end $function$
;


CREATE OR REPLACE FUNCTION public.reserve_settlement_tranche_payout_row(p_tranche_id uuid, p_tailor_profile_id text, p_money_desk_request_id uuid, p_provider text, p_destination_id text, p_route_version text, p_tailor_terms_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tranche public.order_settlement_tranches%rowtype;
  v_order_id text;
  v_plan public.order_settlement_plans%rowtype;
  v_order public.orders%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_request public.money_desk_requests%rowtype;
  v_payment public.order_payments%rowtype;
  v_claim public.payout_claims%rowtype;
  v_destination public.payout_destinations%rowtype;
  v_payout_id text;
  v_business_key text := 'tranche:'||p_tranche_id::text;
  v_provider_key text := v_business_key||':op:1';
  v_locked_destination text;
  v_source_changed boolean := false;
  v_outcome text := 'EXISTING';
begin
  if nullif(btrim(p_destination_id),'') is null
    or nullif(btrim(p_route_version),'') is null then
    raise exception 'Tranche release requires a destination and route';
  end if;
  -- Preserve the shared order-first lock order used by refund/residual claims.
  select order_id into v_order_id from public.order_settlement_tranches
    where id=p_tranche_id;
  if not found then raise exception 'Settlement tranche was not found'; end if;
  select * into v_order from public.orders where id=v_order_id for update;
  if not found then raise exception 'Tranche does not match the accepted order payout route'; end if;
  select * into v_tranche from public.order_settlement_tranches
    where id=p_tranche_id for update;
  if not found or v_tranche.order_id is distinct from v_order_id
    or v_tranche.status not in ('ELIGIBLE','RELEASE_REQUESTED')
    or v_tranche.eligible_at is null or v_tranche.eligible_at>now() then
    raise exception 'Settlement tranche is not eligible for release';
  end if;
  select * into v_plan from public.order_settlement_plans
    where id=v_tranche.plan_id for update;
  if not found or v_plan.status<>'ACTIVE'
    or v_plan.order_id is distinct from v_tranche.order_id
    or v_plan.currency is distinct from v_tranche.currency then
    raise exception 'Settlement plan is not active for this tranche';
  end if;
  if v_order.tailor_id is distinct from v_plan.tailor_id::text
    or v_order.tailor_payout_currency_locked is distinct from v_tranche.currency then
    raise exception 'Tranche does not match the accepted order payout route';
  end if;
  if v_order.accepted_route_snapshot_at is not null then
    if p_provider not in ('STRIPE','BACHS')
      or v_order.charge_provider_snapshot::text is distinct from p_provider
      or v_order.payment_route_version::text is distinct from p_route_version
      or v_order.payment_route_id is null
      or v_order.payout_destination_id is null then
      raise exception 'Tranche release does not match the immutable accepted route';
    end if;
    select * into v_destination from public.payout_destinations
      where id=v_order.payout_destination_id for share;
    if not found or v_destination.tailor_profile_id is distinct from v_order.tailor_profile_id
      or v_destination.provider::text is distinct from p_provider
      or v_destination.legal_entity is distinct from v_order.legal_entity_snapshot
      or v_destination.currency::text is distinct from v_order.tailor_payout_currency_locked::text
      or v_destination.provider_account_ref is distinct from p_destination_id
      or v_destination.active is distinct from true
      or v_destination.transfers_enabled is distinct from true
      or v_destination.payouts_enabled is distinct from true
      or v_destination.first_withdrawal_review_status is distinct from 'CLEARED'
      or v_destination.capability_checked_at is null
      or v_destination.capability_checked_at < now() - interval '15 minutes' then
      raise exception 'Accepted payout destination is not currently ready';
    end if;
  else
    if v_order.tailor_payout_provider_locked::text is distinct from p_provider then
      raise exception 'Tranche does not match the accepted order payout provider';
    end if;
    v_locked_destination := case p_provider
      when 'STRIPE' then nullif(btrim(v_order.tailor_stripe_connect_account_id_locked),'')
      when 'PAYSTACK' then nullif(btrim(v_order.tailor_paystack_recipient_code_locked),'')
      else null
    end;
    if v_locked_destination is null or v_locked_destination is distinct from p_destination_id then
      raise exception 'Tranche destination does not match the accepted order';
    end if;
  end if;
  select * into v_profile from public.tailor_profiles where id=p_tailor_profile_id;
  if not found or v_profile.user_id is distinct from v_plan.tailor_id::text
    or v_profile.payout_account_verified is distinct from true
    or v_profile.payout_reverification_required is true then
    raise exception 'Tranche payout profile is not verified for the tailor';
  end if;
  select * into v_request from public.money_desk_requests
    where id=p_money_desk_request_id for update;
  if not found or v_request.status<>'EXECUTING'
    or v_request.action_type<>'PAYOUT_RELEASE'
    or v_request.target_type<>'SETTLEMENT_TRANCHE'
    or v_request.target_id is distinct from p_tranche_id::text
    or v_request.order_id is distinct from v_tranche.order_id
    or v_request.amount is distinct from v_tranche.amount
    or v_request.currency is distinct from v_tranche.currency
    or v_request.approval_count<v_request.required_approval_count then
    raise exception 'Tranche release needs its exact executing Money Desk request';
  end if;
  if v_tranche.money_desk_request_id is not null
    and v_tranche.money_desk_request_id is distinct from p_money_desk_request_id then
    raise exception 'Tranche is linked to a different Money Desk review';
  end if;
  select * into v_payment from public.order_payments
    where id=v_plan.source_payment_id and order_id=v_tranche.order_id for update;
  v_source_changed := not found or v_payment.phase<>'INITIAL_ORDER'
    or v_payment.status not in ('SUCCEEDED','PARTIAL_REFUND')
    or v_payment.ledger_recorded_at is null
    or not payment_internal.tranche_source_payment_available(v_payment.id,v_plan.id,v_tranche.id)
    or v_payment.currency is distinct from v_tranche.currency
    or v_payment.provider::text is distinct from p_provider;

  select * into v_claim from public.payout_claims
    where business_key=v_business_key for update;
  if not found then
    if v_source_changed then
      if v_payment.id is not null and v_payment.refunded_amount>0
        and not payment_internal.tranche_source_payment_available(
          v_payment.id,v_plan.id,v_tranche.id) then
        raise exception 'Tranche source refund is unclassified or reduces tailor allocation';
      end if;
      raise exception 'Tranche source payment is not fully available';
    end if;
    if exists (select 1 from public.payouts
        where settlement_tranche_id=p_tranche_id) then
      raise exception 'An unclaimed tranche payout exists; reconcile it first';
    end if;
    insert into public.payout_claims (
      business_key,source_kind,source_id,order_id,tailor_profile_id,
      provider,provider_destination_id,currency,amount,route_version,
      earning_policy_version,tailor_terms_version,provider_idempotency_key
    ) values (
      v_business_key,'SETTLEMENT_TRANCHE',p_tranche_id::text,v_tranche.order_id,
      p_tailor_profile_id,p_provider,p_destination_id,v_tranche.currency,
      v_tranche.amount,p_route_version,v_plan.policy_version,
      p_tailor_terms_version,v_provider_key
    ) returning * into v_claim;
    v_outcome := 'RESERVED';
  end if;
  if row(v_claim.source_kind,v_claim.source_id,v_claim.order_id,
         v_claim.tailor_profile_id,v_claim.provider,v_claim.provider_destination_id,
         v_claim.currency,v_claim.amount,v_claim.route_version,
         v_claim.earning_policy_version,v_claim.tailor_terms_version,
         v_claim.provider_idempotency_key)
     is distinct from
     row('SETTLEMENT_TRANCHE',p_tranche_id::text,v_tranche.order_id,
         p_tailor_profile_id,p_provider,p_destination_id,v_tranche.currency,
         v_tranche.amount,p_route_version,v_plan.policy_version,
         p_tailor_terms_version,v_provider_key) then
    raise exception 'Tranche release conflicts with its reserved identity';
  end if;
  if v_claim.payout_id is null then
    if v_outcome='EXISTING' then
      raise exception 'Existing tranche claim has no linked payout';
    end if;
    insert into public.payouts (
      tailor_profile_id,order_id,settlement_tranche_id,source_payment_id,
      amount,currency,provider,status,payout_purpose,
      provider_transfer_status,bank_settlement_status,provider_destination_id,
      provider_response
    ) values (
      p_tailor_profile_id,v_tranche.order_id,p_tranche_id,
      v_plan.source_payment_id,v_tranche.amount,v_tranche.currency,
      p_provider::public.payment_provider,'PROCESSING','SETTLEMENT_TRANCHE',
      'PROCESSING',case when p_provider in ('STRIPE','BACHS') then 'PENDING' else 'NOT_APPLICABLE' end,
      p_destination_id,jsonb_build_object('source','release-settlement-tranche',
        'claim_id',v_claim.id,'money_desk_request_id',p_money_desk_request_id)
    ) returning id into v_payout_id;
    update public.payout_claims set payout_id=v_payout_id where id=v_claim.id;
    update public.order_settlement_tranches set status='RELEASE_REQUESTED',
      payout_id=v_payout_id,money_desk_request_id=p_money_desk_request_id,
      updated_at=now() where id=p_tranche_id;
  else
    v_payout_id := v_claim.payout_id;
    if v_tranche.payout_id is distinct from v_payout_id
      or v_tranche.money_desk_request_id is distinct from p_money_desk_request_id
      or not exists (select 1 from public.payouts where id=v_payout_id
        and settlement_tranche_id=p_tranche_id and order_id=v_tranche.order_id
        and tailor_profile_id=p_tailor_profile_id
        and source_payment_id=v_plan.source_payment_id
        and amount=v_tranche.amount and currency=v_tranche.currency
        and provider::text=p_provider and provider_destination_id=p_destination_id
        and payout_purpose='SETTLEMENT_TRANCHE') then
      raise exception 'Linked tranche payout conflicts with its claim';
    end if;
  end if;
  insert into public.payout_provider_operations (
    claim_id,operation_number,provider,provider_destination_id,currency,
    amount,provider_idempotency_key
  ) values (
    v_claim.id,1,p_provider,p_destination_id,v_tranche.currency,
    v_tranche.amount,v_provider_key
  ) on conflict (claim_id,operation_number) do nothing;
  if not exists (select 1 from public.payout_provider_operations
      where claim_id=v_claim.id and operation_number=1
        and provider=p_provider and provider_destination_id=p_destination_id
        and currency=v_tranche.currency and amount=v_tranche.amount
        and provider_idempotency_key=v_provider_key) then
    raise exception 'Initial tranche provider operation conflicts with its claim';
  end if;
  return jsonb_build_object('outcome',v_outcome,'claim_id',v_claim.id,
    'payout_id',v_payout_id,'status',v_claim.status,
    'provider_transfer_id',v_claim.provider_transfer_id,
    'provider_idempotency_key',v_provider_key);
end $function$
;

CREATE OR REPLACE FUNCTION public.finalize_claimed_route_tranche_release(p_claim_id uuid, p_payout_id text, p_provider_transfer_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_order_id text;
  v_tranche_id text;
  v_claim public.payout_claims%rowtype;
  v_tranche public.order_settlement_tranches%rowtype;
  v_plan public.order_settlement_plans%rowtype;
  v_payout public.payouts%rowtype;
  v_payment public.order_payments%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_ledger_id uuid;
  v_review_needed boolean;
  v_remaining integer;
  v_escrow_result jsonb;
begin
  if p_provider_transfer_id !~ '^tr_[A-Za-z0-9_-]+$' then
    raise exception 'A confirmed provider transfer reference is required';
  end if;
  select order_id,source_id into v_order_id,v_tranche_id
    from public.payout_claims where id=p_claim_id;
  if v_order_id is null or v_tranche_id is null then
    raise exception 'Tranche release requires its exact confirmed payout claim';
  end if;
  perform 1 from public.orders where id=v_order_id for update;
  if not found then raise exception 'Tranche order is missing'; end if;
  select * into v_tranche from public.order_settlement_tranches
    where id::text=v_tranche_id for update;
  if not found or v_tranche.order_id is distinct from v_order_id then
    raise exception 'Claimed tranche no longer matches its order';
  end if;
  select * into v_plan from public.order_settlement_plans
    where id=v_tranche.plan_id for update;
  if not found then raise exception 'Tranche settlement plan is missing'; end if;
  select * into v_payment from public.order_payments
    where id=v_plan.source_payment_id for update;
  select * into v_claim from public.payout_claims where id=p_claim_id for update;
  if not found or v_claim.order_id is distinct from v_order_id
    or v_claim.source_id is distinct from v_tranche_id
    or v_claim.source_kind<>'SETTLEMENT_TRANCHE'
    or v_claim.provider not in ('STRIPE','BACHS')
    or v_claim.payout_id is distinct from p_payout_id
    or v_claim.status not in ('TRANSFERRED','WITHDRAWN')
    or v_claim.transfer_status<>'CONFIRMED'
    or v_claim.provider_transfer_id is distinct from p_provider_transfer_id then
    raise exception 'Tranche release requires its exact confirmed provider claim';
  end if;
  select * into v_payout from public.payouts where id=p_payout_id for update;
  select * into v_operation from public.payout_provider_operations
    where claim_id=p_claim_id and provider_transfer_id=p_provider_transfer_id
      and status in ('TRANSFERRED','WITHDRAWN')
    order by operation_number desc limit 1;
  if v_tranche.id is null or v_plan.order_id is distinct from v_order_id
    or v_plan.policy_version is distinct from v_claim.earning_policy_version
    or v_payout.id is null
    or v_tranche.payout_id is distinct from p_payout_id
    or v_payout.settlement_tranche_id is distinct from v_tranche.id
    or v_payout.order_id is distinct from v_claim.order_id
    or v_payout.tailor_profile_id is distinct from v_claim.tailor_profile_id
    or v_payout.source_payment_id is distinct from v_plan.source_payment_id
    or v_payout.provider::text is distinct from v_claim.provider
    or v_payout.provider_destination_id is distinct from v_operation.provider_destination_id
    or (v_payout.provider_payout_id is not null
      and v_payout.provider_payout_id is distinct from p_provider_transfer_id)
    or v_operation.id is null
    or v_operation.provider is distinct from v_claim.provider
    or v_operation.amount is distinct from v_claim.amount
    or v_operation.currency is distinct from v_claim.currency
    or row(v_tranche.amount,v_tranche.currency)
       is distinct from row(v_claim.amount,v_claim.currency)
    or row(v_payout.amount,v_payout.currency)
       is distinct from row(v_claim.amount,v_claim.currency) then
    raise exception 'Claimed tranche payout does not match its accepted earning and operation';
  end if;
  if v_tranche.status='RELEASED' then
    if v_tranche.provider_reference is distinct from p_provider_transfer_id
      or v_tranche.release_ledger_transaction_id is null
      or v_payout.provider_payout_id is distinct from p_provider_transfer_id
      or v_claim.payout_ledger_transaction_id is distinct from v_tranche.release_ledger_transaction_id then
      raise exception 'Released tranche conflicts with its confirmed transfer';
    end if;
    if v_plan.status='SETTLED' then
      v_escrow_result := public.finalize_staged_settlement_escrow_release(v_order_id,v_plan.id);
      if v_escrow_result->>'outcome'='BLOCKED' then
        insert into public.ops_issues (
          issue_type,severity,status,source,order_id,related_entity_type,
          related_entity_id,provider,title,description,recommended_action,
          dedupe_key,metadata
        ) values (
          'PAYOUT_FAILED','HIGH','OPEN','release-settlement-tranche',
          v_order_id,'SETTLEMENT_PLAN',v_plan.id::text,v_claim.provider,
          'Final staged settlement marker needs review',
          'Every tranche transfer is recorded, but the final order marker did not pass the plan, claim, ledger, dispute, refund, and terminal-stage checks.',
          'Review the reconciled tranche timeline and resolve the outstanding blocker before retrying final settlement.',
          'staged-escrow-finalize:'||v_plan.id::text,
          jsonb_build_object('plan_id',v_plan.id,'order_id',v_order_id,
            'claim_id',p_claim_id,'payout_id',p_payout_id,
            'provider_transfer_id',p_provider_transfer_id)
        ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now();
      end if;
    end if;
    return jsonb_build_object('outcome','EXISTING','tranche_id',v_tranche.id,
      'payout_id',p_payout_id,'ledger_id',v_tranche.release_ledger_transaction_id,
      'provider_transfer_id',p_provider_transfer_id,
      'escrow_outcome',coalesce(v_escrow_result->>'outcome','NOT_FINAL'));
  end if;
  if v_tranche.status not in ('RELEASE_REQUESTED','BLOCKED','CANCELLED')
    or v_tranche.payout_id is distinct from p_payout_id then
    raise exception 'Tranche has no reserved release to complete';
  end if;
  v_review_needed := v_plan.status<>'ACTIVE'
    or v_tranche.status<>'RELEASE_REQUESTED'
    or v_payment.id is null
    or not payment_internal.tranche_source_payment_available(v_payment.id,v_plan.id,v_tranche.id);
  v_ledger_id := public.post_commercial_ledger_transaction(
    'settlement-release:'||v_tranche.id::text,'ADJUSTMENT','SETTLEMENT_RELEASE',
    v_tranche.order_id,v_plan.source_payment_id,v_plan.policy_version,1,
    v_tranche.correlation_id,p_provider_transfer_id,
    jsonb_build_array(
      jsonb_build_object('accountCode','TAILOR_ELIGIBLE','accountScope',v_tranche.order_id,
        'direction','DEBIT','amount',v_tranche.amount,'currency',v_tranche.currency),
      jsonb_build_object('accountCode','TAILOR_RELEASED','accountScope',v_tranche.order_id,
        'direction','CREDIT','amount',v_tranche.amount,'currency',v_tranche.currency)),
    jsonb_build_object('tranche_id',v_tranche.id,'tranche_code',v_tranche.code,
      'payout_id',p_payout_id,'provider',v_claim.provider),null,null,'SYSTEM',v_tranche.currency,v_tranche.amount,
    v_tranche.currency,v_tranche.amount,1,0);
  update public.payout_claims set payout_ledger_transaction_id=v_ledger_id,
      withdrawal_status='NOT_APPLICABLE'
    where id=p_claim_id and (payout_ledger_transaction_id is null
      or payout_ledger_transaction_id=v_ledger_id);
  if not found then raise exception 'Payout ledger receipt conflicts with its claim'; end if;
  update public.payouts set status='PROCESSING',
    provider_payout_id=p_provider_transfer_id,
    provider_transfer_status='AVAILABLE_IN_PROVIDER_BALANCE',
    bank_settlement_status='NOT_APPLICABLE',completed_at=null,processed_at=now()
    where id=p_payout_id;
  update public.order_settlement_tranches set status='RELEASED',
    released_at=now(),provider_reference=p_provider_transfer_id,
    release_ledger_transaction_id=v_ledger_id,updated_at=now()
    where id=v_tranche.id;
  insert into public.order_settlement_events (
    plan_id,tranche_id,event_type,actor_role,payload,correlation_id
  ) values (
    v_plan.id,v_tranche.id,'TRANCHE_RELEASED','SYSTEM',
    jsonb_build_object('payout_id',p_payout_id,
      'provider_transfer_id',p_provider_transfer_id,
      'provider',v_claim.provider,'provider_terminal_status','paid',
      'review_needed',v_review_needed),v_tranche.correlation_id);
  if v_review_needed then
    insert into public.ops_issues (
      issue_type,severity,status,source,order_id,related_entity_type,
      related_entity_id,provider,title,description,recommended_action,
      dedupe_key,metadata
    ) values (
      'PAYOUT_LATE_SUCCESS','HIGH','OPEN','provider-transfer-reconcile',
      v_tranche.order_id,'SETTLEMENT_TRANCHE',v_tranche.id::text,v_claim.provider,
      'Tranche transfer confirmed during a payment or review change',
      'The provider confirmed a tranche transfer after its source payment or settlement review changed. The transfer was recorded so real money is not lost.',
      'Review the payment/refund, dispute, and tailor timeline before closing this case.',
      'tranche-release-review:'||v_tranche.id::text,
      jsonb_build_object('claim_id',p_claim_id,'payout_id',p_payout_id,
        'provider_transfer_id',p_provider_transfer_id,
        'plan_status',v_plan.status,'prior_tranche_status',v_tranche.status,
        'payment_status',v_payment.status)
    ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now();
  end if;
  select count(*) into v_remaining from public.order_settlement_tranches
    where plan_id=v_plan.id and status<>'RELEASED';
  if v_remaining=0 and v_plan.status='ACTIVE' then
    update public.order_settlement_plans set status='SETTLED',updated_at=now()
      where id=v_plan.id;
    v_escrow_result := public.finalize_staged_settlement_escrow_release(v_order_id,v_plan.id);
    if v_escrow_result->>'outcome'='BLOCKED' then
      v_review_needed := true;
      insert into public.ops_issues (
        issue_type,severity,status,source,order_id,related_entity_type,
        related_entity_id,provider,title,description,recommended_action,
        dedupe_key,metadata
      ) values (
        'PAYOUT_FAILED','HIGH','OPEN','release-settlement-tranche',
        v_order_id,'SETTLEMENT_PLAN',v_plan.id::text,v_claim.provider,
        'Final staged settlement marker needs review',
        'Every tranche transfer is recorded, but the final order marker did not pass the plan, claim, ledger, dispute, refund, and terminal-stage checks.',
        'Review the reconciled tranche timeline and resolve the outstanding blocker before retrying final settlement.',
        'staged-escrow-finalize:'||v_plan.id::text,
        jsonb_build_object('plan_id',v_plan.id,'order_id',v_order_id,
          'claim_id',p_claim_id,'payout_id',p_payout_id,
          'provider_transfer_id',p_provider_transfer_id)
      ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now();
    end if;
  end if;
  return jsonb_build_object('outcome','COMPLETED','tranche_id',v_tranche.id,
    'payout_id',p_payout_id,'ledger_id',v_ledger_id,
    'provider_transfer_id',p_provider_transfer_id,'review_needed',v_review_needed,
    'escrow_outcome',coalesce(v_escrow_result->>'outcome','NOT_FINAL'));
end;
$function$
;

CREATE OR REPLACE FUNCTION payment_internal.ensure_order_work_funding_source(p_payment_id uuid, p_plan_id uuid, p_refund_claim_id uuid DEFAULT NULL::uuid, p_payout_claim_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.order_settlement_plans%rowtype;
  v_payment public.order_payments%rowtype;
  v_source public.order_work_funding_sources%rowtype;
  v_tranche_id uuid;
begin
  select * into v_plan from public.order_settlement_plans where id=p_plan_id;
  select * into v_payment from public.order_payments where id=p_payment_id for update;
  if v_plan.id is null or v_payment.id is null
    or v_plan.source_payment_id is distinct from v_payment.id
    or v_plan.order_id is distinct from v_payment.order_id::text
    or v_payment.phase<>'INITIAL_ORDER'
    or v_payment.status not in ('SUCCEEDED','PARTIAL_REFUND')
    or v_payment.ledger_recorded_at is null then
    raise exception 'Staged work source has no matching captured payment';
  end if;
  if p_payout_claim_id is not null then
    select source_id::uuid into v_tranche_id from public.payout_claims
      where id=p_payout_claim_id and source_kind='SETTLEMENT_TRANCHE';
  end if;
  select * into v_source from public.order_work_funding_sources
    where payment_id=p_payment_id for update;
  if exists (select 1 from public.payout_claims pc
      join public.order_settlement_tranches tr on tr.id::text=pc.source_id
      where pc.source_kind='SETTLEMENT_TRANCHE' and tr.plan_id=p_plan_id
        and pc.id is distinct from p_payout_claim_id
        and not exists (select 1 from public.order_work_funding_positions pos
          where pos.payout_claim_id=pc.id))
    or exists (select 1 from public.order_payment_refund_claims rc
      where rc.payment_id=p_payment_id and rc.id is distinct from p_refund_claim_id
        and not exists (select 1 from public.order_work_funding_positions pos
          where pos.refund_claim_id=rc.id)
        and rc.status not in ('FAILED_RECONCILED')
        and (rc.status<>'SUCCEEDED' or not
          payment_internal.tranche_source_payment_available(p_payment_id,p_plan_id,v_tranche_id))) then
    raise exception 'Unpositioned staged work claim requires Money Desk reconciliation';
  end if;
  if v_source.payment_id is null then
    -- Never assign old, untracked money to a fresh charge position by guesswork.
    if not payment_internal.tranche_source_payment_available(
        p_payment_id,p_plan_id,v_tranche_id)
      or exists (select 1 from public.payouts
        where source_payment_id=p_payment_id
          and payout_purpose in ('ORDER_EARNING','SETTLEMENT_TRANCHE'))
      or exists (select 1 from public.order_payment_refund_claims
        where payment_id=p_payment_id and id is distinct from p_refund_claim_id
          and status not in ('SUCCEEDED','FAILED_RECONCILED')) then
      raise exception 'Historical work funding requires Money Desk reconciliation';
    end if;
    insert into public.order_work_funding_sources (
      payment_id,plan_id,order_id,currency,captured_tailor_amount
    ) values (
      v_payment.id,v_plan.id,v_plan.order_id,v_plan.currency,v_plan.entitlement_amount
    ) on conflict (payment_id) do nothing;
    select * into v_source from public.order_work_funding_sources
      where payment_id=p_payment_id for update;
  end if;
  if v_source.plan_id is distinct from v_plan.id
    or v_source.order_id is distinct from v_plan.order_id
    or v_source.currency is distinct from v_plan.currency
    or v_source.captured_tailor_amount is distinct from v_plan.entitlement_amount then
    raise exception 'Staged work source identity changed';
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION payment_internal.reserve_staged_work_for_payout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tranche public.order_settlement_tranches%rowtype;
  v_plan public.order_settlement_plans%rowtype;
begin
  if new.source_kind not in ('SETTLEMENT_TRANCHE','RESIDUAL_SETTLEMENT') then
    return new;
  end if;
  if new.source_kind='SETTLEMENT_TRANCHE' then
    select * into v_tranche from public.order_settlement_tranches
      where id::text=new.source_id;
    select * into v_plan from public.order_settlement_plans
      where id=v_tranche.plan_id;
    if v_tranche.id is null or v_plan.id is null
      or v_tranche.order_id is distinct from new.order_id
      or v_tranche.amount is distinct from new.amount
      or v_plan.status<>'ACTIVE' then
      raise exception 'Staged payout lacks an exact active tranche';
    end if;
    if exists (select 1 from public.order_payment_refund_claims
        where payment_id=v_plan.source_payment_id
          and status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING')) then
      raise exception 'Staged work has a refund claim; review before payout';
    end if;
  else
    select * into v_plan from public.order_settlement_plans
      where order_id=new.order_id;
    if v_plan.id is null or v_plan.status not in ('ACTIVE','FROZEN')
      or v_plan.policy_version is distinct from new.earning_policy_version
      or new.source_id is distinct from new.order_id then
      raise exception 'Residual payout lacks its accepted staged plan';
    end if;
    -- A completed close-order refund is expected here. An unresolved provider
    -- refund is not: it may still consume the same remaining work position.
    if exists (select 1 from public.order_payment_refund_claims
        where payment_id=v_plan.source_payment_id
          and status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING')) then
      raise exception 'Residual payout waits for the refund provider outcome';
    end if;
  end if;
  perform payment_internal.ensure_order_work_funding_source(
    v_plan.source_payment_id,v_plan.id,null,new.id);
  insert into public.order_work_funding_positions (
    source_payment_id,use_kind,payout_claim_id,amount
  ) values (v_plan.source_payment_id,'PAYOUT',new.id,new.amount);
  return new;
end $function$
;
