-- Make the already-designed reviewed TAILOR adjustment payout flow read the
-- accepted route snapshot and support its proven provider adapters. This does
-- not enable routes or move money by itself.

create or replace function public.guard_tailor_adjustment_payout_claim()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_adjustment public.commercial_adjustments%rowtype;
  v_order public.orders%rowtype;
  v_profile public.tailor_profiles%rowtype;
  v_destination public.payout_destinations%rowtype;
  v_payment public.order_payments%rowtype;
  v_capture public.commercial_ledger_transactions%rowtype;
  v_capture_count integer;
  v_earning integer;
  v_gate jsonb;
begin
  if new.source_kind <> 'TAILOR_ADJUSTMENT' then return new; end if;
  if new.source_id is null or new.source_id !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'Adjustment claim needs its exact source ID';
  end if;
  select * into v_adjustment from public.commercial_adjustments
    where id = new.source_id::uuid for update;
  if v_adjustment.id is null
    or new.business_key is distinct from 'adjustment:' || v_adjustment.id::text
    or new.provider_idempotency_key is distinct from
      'adjustment:' || v_adjustment.id::text || ':op:1'
    or new.order_id is distinct from v_adjustment.order_id
    or new.currency is distinct from v_adjustment.currency
    or new.earning_policy_version is distinct from v_adjustment.tailor_release_policy_version
    or new.status <> 'RESERVED' or new.transfer_status <> 'NOT_STARTED'
    or new.withdrawal_status <> 'NOT_STARTED' or new.payout_id is not null
    or new.provider_transfer_id is not null then
    raise exception 'Adjustment claim identity is not frozen';
  end if;

  select * into v_order from public.orders where id_text = v_adjustment.order_id for update;
  if v_order.id is null
    or v_order.tailor_profile_id::text is distinct from new.tailor_profile_id
    or v_order.accepted_route_snapshot_at is null
    or v_order.payment_route_id is null
    or v_order.payment_route_version is null
    or v_order.payout_destination_id is null
    or v_order.charge_provider_snapshot::text not in ('STRIPE', 'BACHS')
    or v_order.charge_provider_snapshot::text is distinct from new.provider
    or v_order.payment_route_version is distinct from new.route_version
    or v_order.tailor_terms_version_snapshot is distinct from new.tailor_terms_version
    or v_order.tailor_payout_currency_locked is distinct from new.currency then
    raise exception 'Adjustment claim differs from its accepted route snapshot';
  end if;
  select * into v_destination from public.payout_destinations
    where id = v_order.payout_destination_id for share;
  if v_destination.id is null
    or v_destination.tailor_profile_id is distinct from v_order.tailor_profile_id
    or v_destination.provider::text is distinct from new.provider
    or v_destination.legal_entity is distinct from v_order.legal_entity_snapshot
    or v_destination.currency::text is distinct from new.currency
    or v_destination.active is distinct from true
    or v_destination.transfers_enabled is distinct from true
    or v_destination.payouts_enabled is distinct from true
    or v_destination.first_withdrawal_review_status is distinct from 'CLEARED'
    or v_destination.capability_checked_at is null
    or v_destination.capability_checked_at < now() - interval '15 minutes'
    or v_destination.provider_account_ref is distinct from new.provider_destination_id then
    raise exception 'Adjustment destination is not the ready accepted destination';
  end if;

  select * into v_profile from public.tailor_profiles where id::text = new.tailor_profile_id;
  if v_profile.id is null
    or v_profile.user_id::text is distinct from v_adjustment.tailor_id
    or v_profile.payout_account_verified is distinct from true
    or v_profile.payout_reverification_required is true then
    raise exception 'Adjustment tailor payout destination is not verified';
  end if;
  select * into v_payment from public.order_payments
    where id = v_adjustment.payment_id for update;
  if v_payment.id is null or v_payment.phase::text <> 'ADJUSTMENT'
    or v_payment.order_id::text is distinct from v_adjustment.order_id
    or v_payment.currency is distinct from v_adjustment.currency
    or v_payment.provider::text is distinct from new.provider
    or v_payment.status::text <> 'SUCCEEDED'
    or v_payment.refunded_amount <> 0
    or v_payment.amount <> v_adjustment.amount_delta
    or v_payment.ledger_recorded_at is null
    or v_payment.provider_payment_id is null
    or v_payment.commercial_breakdown->>'adjustmentAllocation' is distinct from 'TAILOR' then
    raise exception 'Adjustment charge has no unreversed tailor capture';
  end if;

  select count(*) into v_capture_count from public.commercial_ledger_transactions
    where payment_id = v_payment.id and order_id = v_adjustment.order_id
      and transaction_kind = 'CAPTURE' and purpose = 'ADJUSTMENT';
  if v_capture_count <> 1 then raise exception 'Adjustment needs one exact capture ledger transaction'; end if;
  select * into v_capture from public.commercial_ledger_transactions
    where payment_id = v_payment.id and order_id = v_adjustment.order_id
      and transaction_kind = 'CAPTURE' and purpose = 'ADJUSTMENT';
  select coalesce(sum(amount), 0)::integer into v_earning
    from public.commercial_ledger_entries
    where transaction_id = v_capture.id and account_code = 'TAILOR_ENTITLEMENT'
      and account_scope = 'order-adjustment' and direction = 'CREDIT'
      and currency = v_adjustment.currency;
  if v_capture.original_amount <> v_payment.amount
    or v_capture.original_currency is distinct from v_payment.currency
    or v_capture.provider_reference is distinct from v_payment.provider_payment_id
    or v_earning <= 0 or v_earning <> new.amount
    or v_earning is distinct from (v_payment.commercial_breakdown->>'subtotalAmount')::integer then
    raise exception 'Adjustment claim differs from the captured tailor earning';
  end if;
  if exists (select 1 from public.order_payment_refund_claims r where r.payment_id = v_adjustment.payment_id)
    or exists (select 1 from public.adjustment_money_operation_claims c
      where c.adjustment_id = v_adjustment.id and c.operation_kind = 'REFUND') then
    raise exception 'Adjustment earning requires Money Desk refund reconciliation';
  end if;
  v_gate := public.tailor_adjustment_release_gate(v_adjustment.id);
  if v_gate->>'state' <> 'READY_FOR_MONEY_DESK' then
    raise exception 'Adjustment delivery/protection gate is not ready: %', v_gate->>'state';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_tailor_adjustment_payout_claim()
  from public, anon, authenticated, service_role;

create or replace function public.reserve_reviewed_tailor_adjustment_payout(
  p_adjustment_id uuid,
  p_money_desk_request_id uuid,
  p_route_version text,
  p_tailor_terms_version text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id text;
  v_order public.orders%rowtype;
  v_adjustment public.commercial_adjustments%rowtype;
  v_destination public.payout_destinations%rowtype;
  v_request public.money_desk_requests%rowtype;
  v_payment public.order_payments%rowtype;
  v_capture public.commercial_ledger_transactions%rowtype;
  v_capture_count integer;
  v_amount integer;
  v_provider text;
  v_provider_destination text;
  v_business_key text := 'adjustment:' || p_adjustment_id::text;
  v_provider_key text := 'adjustment:' || p_adjustment_id::text || ':op:1';
  v_claim public.payout_claims%rowtype;
  v_operation public.adjustment_money_operation_claims%rowtype;
  v_payout public.payouts%rowtype;
  v_provider_operation public.payout_provider_operations%rowtype;
  v_gate jsonb;
begin
  if p_adjustment_id is null or nullif(btrim(p_route_version), '') is null then
    raise exception 'Adjustment payout requires its accepted route version';
  end if;
  select order_id into v_order_id from public.commercial_adjustments where id = p_adjustment_id;
  if v_order_id is null then raise exception 'Adjustment not found'; end if;
  perform 1 from public.orders where id_text = v_order_id for update;
  if not found then raise exception 'Adjustment order not found'; end if;
  select * into v_order from public.orders where id_text = v_order_id;
  select * into v_adjustment from public.commercial_adjustments
    where id = p_adjustment_id for update;
  if v_adjustment.id is null or v_adjustment.order_id is distinct from v_order.id_text
    or v_adjustment.status not in ('PAID', 'COMPLETED')
    or v_adjustment.tailor_release_policy_version is distinct from
      'tailor-adjustment-delivery-72h-reviewed-v1'
    or v_order.accepted_route_snapshot_at is null
    or v_order.payment_route_id is null
    or v_order.payment_route_version is distinct from p_route_version
    or v_order.tailor_terms_version_snapshot is distinct from p_tailor_terms_version
    or v_order.payout_destination_id is null then
    raise exception 'Adjustment is not eligible under its accepted route snapshot';
  end if;
  v_provider := v_order.charge_provider_snapshot::text;
  if v_provider not in ('STRIPE', 'BACHS') then
    raise exception 'Accepted adjustment payout provider is not supported';
  end if;
  select * into v_destination from public.payout_destinations
    where id = v_order.payout_destination_id for share;
  if v_destination.id is null
    or v_destination.tailor_profile_id is distinct from v_order.tailor_profile_id
    or v_destination.provider::text is distinct from v_provider
    or v_destination.legal_entity is distinct from v_order.legal_entity_snapshot
    or v_destination.currency::text is distinct from v_order.tailor_payout_currency_locked
    or nullif(btrim(v_destination.provider_account_ref), '') is null then
    raise exception 'Accepted payout destination identity is missing';
  end if;
  v_provider_destination := v_destination.provider_account_ref;
  if v_order.tailor_payout_currency_locked is distinct from v_adjustment.currency then
    raise exception 'Adjustment currency differs from the accepted payout currency';
  end if;

  select * into v_payment from public.order_payments
    where id = v_adjustment.payment_id for update;
  select count(*) into v_capture_count from public.commercial_ledger_transactions
    where payment_id = v_adjustment.payment_id and order_id = v_order.id_text
      and transaction_kind = 'CAPTURE' and purpose = 'ADJUSTMENT';
  if v_payment.id is null or v_capture_count <> 1 then
    raise exception 'Adjustment has no exact captured payment';
  end if;
  select * into v_capture from public.commercial_ledger_transactions
    where payment_id = v_payment.id and order_id = v_order.id_text
      and transaction_kind = 'CAPTURE' and purpose = 'ADJUSTMENT';
  select coalesce(sum(amount), 0)::integer into v_amount
    from public.commercial_ledger_entries
    where transaction_id = v_capture.id and account_code = 'TAILOR_ENTITLEMENT'
      and account_scope = 'order-adjustment' and direction = 'CREDIT'
      and currency = v_adjustment.currency;
  if v_amount <= 0 or v_payment.status::text <> 'SUCCEEDED'
    or v_payment.refunded_amount <> 0
    or v_payment.provider::text is distinct from v_provider
    or v_payment.amount is distinct from v_adjustment.amount_delta
    or v_payment.ledger_recorded_at is null
    or v_payment.commercial_breakdown->>'adjustmentAllocation' is distinct from 'TAILOR'
    or v_amount is distinct from (v_payment.commercial_breakdown->>'subtotalAmount')::integer then
    raise exception 'Adjustment captured earning is not releasable';
  end if;
  select * into v_request from public.money_desk_requests
    where id = p_money_desk_request_id for update;
  if v_request.id is null or v_request.action_type <> 'PAYOUT_RELEASE'
    or v_request.target_type <> 'TAILOR_ADJUSTMENT'
    or v_request.target_id <> p_adjustment_id::text
    or v_request.order_id <> v_order.id_text
    or v_request.amount is distinct from v_amount
    or v_request.currency is distinct from v_adjustment.currency then
    raise exception 'Adjustment payout request identity changed';
  end if;

  select * into v_claim from public.payout_claims
    where business_key = v_business_key for update;
  if v_claim.id is not null then
    select * into v_operation from public.adjustment_money_operation_claims
      where adjustment_id = p_adjustment_id and operation_kind = 'PAYOUT' for update;
    select * into v_payout from public.payouts where id = v_claim.payout_id for update;
    select * into v_provider_operation from public.payout_provider_operations
      where claim_id = v_claim.id and operation_number = 1 for update;
    if v_claim.source_kind <> 'TAILOR_ADJUSTMENT'
      or v_claim.source_id <> p_adjustment_id::text
      or v_claim.order_id <> v_order.id_text
      or v_claim.tailor_profile_id <> v_order.tailor_profile_id::text
      or v_claim.amount <> v_amount or v_claim.currency <> v_adjustment.currency
      or v_claim.provider <> v_provider
      or v_claim.provider_destination_id <> v_provider_destination
      or v_claim.route_version <> p_route_version
      or v_claim.earning_policy_version <> v_adjustment.tailor_release_policy_version
      or v_claim.tailor_terms_version is distinct from p_tailor_terms_version
      or v_claim.provider_idempotency_key <> v_provider_key
      or v_operation.id is null
      or v_operation.money_desk_request_id <> p_money_desk_request_id
      or v_operation.payout_claim_id <> v_claim.id
      or v_operation.source_payment_id <> v_payment.id
      or v_operation.capture_transaction_id <> v_capture.id
      or v_payout.id is null or v_payout.tailor_adjustment_id <> p_adjustment_id
      or v_payout.source_payment_id <> v_payment.id
      or v_payout.amount <> v_amount or v_payout.currency <> v_adjustment.currency
      or v_payout.provider::text <> v_provider
      or v_payout.provider_destination_id <> v_provider_destination
      or v_provider_operation.id is null
      or v_provider_operation.provider <> v_provider
      or v_provider_operation.provider_destination_id <> v_provider_destination
      or v_provider_operation.provider_idempotency_key <> v_provider_key then
      raise exception 'Existing adjustment payout reservation needs reconciliation';
    end if;
    if v_claim.status = 'RESERVED' and v_request.status <> 'EXECUTING' then
      raise exception 'An unstarted adjustment payout requires an executing Money Desk request';
    end if;
    return jsonb_build_object('outcome', 'EXISTING', 'claim_id', v_claim.id,
      'operation_id', v_operation.id, 'payout_id', v_payout.id,
      'provider_operation_id', v_provider_operation.id,
      'provider_idempotency_key', v_provider_key, 'status', v_claim.status,
      'provider_transfer_id', v_claim.provider_transfer_id,
      'amount', v_claim.amount, 'currency', v_claim.currency,
      'provider', v_claim.provider, 'provider_destination_id', v_claim.provider_destination_id);
  end if;

  if v_request.status <> 'EXECUTING' or v_request.approved_at is null
    or v_request.approval_count <> v_request.required_approval_count
    or not exists (select 1 from public.money_desk_execution_attempts e
      where e.request_id = v_request.id and e.status = 'PROCESSING') then
    raise exception 'Adjustment payout is not in approved Money Desk execution';
  end if;
  if exists (select 1 from public.adjustment_money_operation_claims
      where adjustment_id = p_adjustment_id and operation_kind = 'REFUND') then
    raise exception 'Adjustment refund reservation blocks payout';
  end if;
  if v_destination.active is distinct from true
    or v_destination.transfers_enabled is distinct from true
    or v_destination.payouts_enabled is distinct from true
    or v_destination.first_withdrawal_review_status is distinct from 'CLEARED'
    or v_destination.capability_checked_at is null
    or v_destination.capability_checked_at < now() - interval '15 minutes' then
    raise exception 'Accepted payout destination is not currently ready';
  end if;
  v_gate := public.tailor_adjustment_release_gate(p_adjustment_id);
  if v_gate->>'state' <> 'READY_FOR_MONEY_DESK' then
    raise exception 'Adjustment release gate is not ready: %', v_gate->>'state';
  end if;
  insert into public.payout_claims(business_key, source_kind, source_id,
    order_id, tailor_profile_id, provider, provider_destination_id, currency,
    amount, route_version, earning_policy_version, tailor_terms_version,
    provider_idempotency_key)
  values (v_business_key, 'TAILOR_ADJUSTMENT', p_adjustment_id::text,
    v_order.id_text, v_order.tailor_profile_id::text, v_provider,
    v_provider_destination, v_adjustment.currency, v_amount, p_route_version,
    v_adjustment.tailor_release_policy_version, p_tailor_terms_version, v_provider_key)
  returning * into v_claim;
  insert into public.adjustment_money_operation_claims(adjustment_id,
    source_payment_id, capture_transaction_id, operation_kind, request_key,
    amount, currency, money_desk_request_id, payout_claim_id)
  values (p_adjustment_id, v_payment.id, v_capture.id, 'PAYOUT',
    v_business_key || ':payout', v_amount, v_adjustment.currency,
    p_money_desk_request_id, v_claim.id)
  returning * into v_operation;
  insert into public.payouts(tailor_profile_id, order_id, source_payment_id,
    tailor_adjustment_id, amount, currency, provider, status, payout_purpose,
    provider_transfer_status, bank_settlement_status, provider_destination_id,
    provider_response)
  values (v_order.tailor_profile_id, v_order.id, v_payment.id, p_adjustment_id,
    v_amount, v_adjustment.currency, v_provider::public.payment_provider,
    'PROCESSING', 'TAILOR_ADJUSTMENT', 'PROCESSING', 'NOT_APPLICABLE',
    v_provider_destination, jsonb_build_object('source', 'reviewed-adjustment-v2',
      'claim_id', v_claim.id, 'money_desk_request_id', p_money_desk_request_id))
  returning * into v_payout;
  update public.payout_claims set payout_id = v_payout.id where id = v_claim.id;
  insert into public.payout_provider_operations(claim_id, operation_number,
    provider, provider_destination_id, currency, amount, provider_idempotency_key)
  values (v_claim.id, 1, v_provider, v_provider_destination,
    v_adjustment.currency, v_amount, v_provider_key)
  returning * into v_provider_operation;
  return jsonb_build_object('outcome', 'RESERVED', 'claim_id', v_claim.id,
    'operation_id', v_operation.id, 'payout_id', v_payout.id,
    'provider_operation_id', v_provider_operation.id,
    'provider_idempotency_key', v_provider_key, 'status', v_claim.status,
    'provider_transfer_id', v_claim.provider_transfer_id,
    'amount', v_claim.amount, 'currency', v_claim.currency,
    'provider', v_claim.provider, 'provider_destination_id', v_claim.provider_destination_id);
end;
$$;

revoke all on function public.reserve_reviewed_tailor_adjustment_payout(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_reviewed_tailor_adjustment_payout(uuid, uuid, text, text)
  to service_role;

create or replace function public.finalize_reviewed_adjustment_transfer(
  p_adjustment_id uuid,
  p_claim_id uuid,
  p_provider_transfer_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id text;
  v_adjustment public.commercial_adjustments%rowtype;
  v_order public.orders%rowtype;
  v_claim public.payout_claims%rowtype;
  v_operation public.adjustment_money_operation_claims%rowtype;
  v_provider_operation public.payout_provider_operations%rowtype;
  v_payout public.payouts%rowtype;
  v_payment public.order_payments%rowtype;
  v_request public.money_desk_requests%rowtype;
  v_attempt public.payout_attempts%rowtype;
  v_ledger public.commercial_ledger_transactions%rowtype;
  v_ledger_id uuid;
  v_entitlement bigint;
  v_entitlement_debit integer;
  v_subsidy integer;
  v_entries jsonb;
  v_debit bigint;
  v_credit bigint;
  v_entry_count integer;
  v_review_needed boolean;
  v_existing boolean;
begin
  if p_adjustment_id is null or p_claim_id is null
    or p_provider_transfer_id !~ '^tr_[A-Za-z0-9_-]+$' then
    raise exception 'Exact confirmed adjustment transfer is required';
  end if;
  select order_id into v_order_id from public.commercial_adjustments where id = p_adjustment_id;
  if v_order_id is null then raise exception 'Adjustment is missing'; end if;
  perform 1 from public.orders where id_text = v_order_id for update;
  if not found then raise exception 'Adjustment order is missing'; end if;
  select * into v_order from public.orders where id_text = v_order_id;
  select * into v_adjustment from public.commercial_adjustments
    where id = p_adjustment_id for update;
  select * into v_claim from public.payout_claims where id = p_claim_id for update;
  if v_adjustment.id is null or v_claim.id is null
    or v_adjustment.order_id <> v_order_id
    or v_adjustment.status not in ('PAID', 'COMPLETED')
    or v_claim.business_key <> 'adjustment:' || p_adjustment_id::text
    or v_claim.source_kind <> 'TAILOR_ADJUSTMENT'
    or v_claim.source_id <> p_adjustment_id::text
    or v_claim.order_id <> v_order_id
    or v_claim.provider not in ('STRIPE', 'BACHS')
    or v_claim.status not in ('TRANSFERRED', 'WITHDRAWN')
    or v_claim.transfer_status <> 'CONFIRMED'
    or v_claim.provider_transfer_id <> p_provider_transfer_id
    or v_claim.currency <> v_adjustment.currency
    or v_claim.earning_policy_version is distinct from v_adjustment.tailor_release_policy_version
    or v_order.accepted_route_snapshot_at is null
    or v_order.charge_provider_snapshot::text is distinct from v_claim.provider
    or v_order.payment_route_version is distinct from v_claim.route_version
    or v_order.payout_destination_id is null then
    raise exception 'Adjustment has no exact confirmed provider payout claim';
  end if;
  select * into v_operation from public.adjustment_money_operation_claims
    where adjustment_id = p_adjustment_id and operation_kind = 'PAYOUT' for update;
  select * into v_payout from public.payouts where id = v_claim.payout_id for update;
  select * into v_provider_operation from public.payout_provider_operations
    where claim_id = p_claim_id and operation_number = 1 for update;
  if v_operation.id is null or v_payout.id is null or v_provider_operation.id is null
    or v_operation.payout_claim_id <> v_claim.id
    or v_operation.source_payment_id <> v_adjustment.payment_id
    or v_operation.amount <> v_claim.amount or v_operation.currency <> v_claim.currency
    or v_operation.status not in ('RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'SUCCEEDED')
    or (v_operation.provider_operation_id is not null and
      v_operation.provider_operation_id <> p_provider_transfer_id)
    or v_payout.tailor_adjustment_id <> p_adjustment_id
    or v_payout.payout_purpose <> 'TAILOR_ADJUSTMENT'
    or v_payout.order_id::text <> v_order_id
    or v_payout.source_payment_id <> v_adjustment.payment_id
    or v_payout.provider::text <> v_claim.provider
    or v_payout.provider_destination_id <> v_claim.provider_destination_id
    or v_payout.amount <> v_claim.amount or v_payout.currency <> v_claim.currency
    or v_payout.status not in ('PENDING', 'PROCESSING', 'PAID')
    or (v_payout.provider_payout_id is not null and
      v_payout.provider_payout_id <> p_provider_transfer_id)
    or v_provider_operation.provider <> v_claim.provider
    or v_provider_operation.provider_destination_id <> v_claim.provider_destination_id
    or v_provider_operation.amount <> v_claim.amount
    or v_provider_operation.currency <> v_claim.currency
    or v_provider_operation.provider_idempotency_key <> v_claim.provider_idempotency_key
    or v_provider_operation.status not in ('RESERVED', 'PROVIDER_UNKNOWN',
      'PROVIDER_PENDING', 'TRANSFERRED', 'WITHDRAWN')
    or (v_provider_operation.provider_transfer_id is not null and
      v_provider_operation.provider_transfer_id <> p_provider_transfer_id) then
    raise exception 'Adjustment payout reservation needs reconciliation';
  end if;
  select * into v_attempt from public.payout_attempts
    where claim_id = p_claim_id and status = 'SUCCEEDED'
      and provider_operation_id = p_provider_transfer_id order by attempt_number limit 1;
  if v_attempt.id is null then raise exception 'Adjustment transfer has no confirmed provider attempt'; end if;
  select * into v_payment from public.order_payments where id = v_adjustment.payment_id;
  if v_payment.id is null or v_payment.order_id::text <> v_order_id
    or v_payment.phase::text <> 'ADJUSTMENT'
    or v_payment.provider::text <> v_claim.provider
    or v_payment.currency <> v_claim.currency
    or v_payment.status::text not in ('SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED')
    or v_payment.ledger_recorded_at is null then
    raise exception 'Adjustment payment changed; Money Desk must reconcile transfer';
  end if;
  select * into v_request from public.money_desk_requests
    where id = v_operation.money_desk_request_id;
  if v_request.id is null or v_request.action_type <> 'PAYOUT_RELEASE'
    or v_request.target_type <> 'TAILOR_ADJUSTMENT'
    or v_request.target_id <> p_adjustment_id::text
    or v_request.order_id <> v_order_id
    or v_request.amount <> v_claim.amount or v_request.currency <> v_claim.currency then
    raise exception 'Adjustment Money Desk approval identity changed';
  end if;
  v_review_needed := v_request.status not in ('EXECUTING', 'SUCCEEDED')
    or v_payment.status::text <> 'SUCCEEDED'
    or v_payment.refunded_amount <> 0
    or exists (select 1 from public.adjustment_money_operation_claims
      where adjustment_id = p_adjustment_id and operation_kind = 'REFUND'
        and status <> 'FAILED_RECONCILED');
  v_existing := v_operation.status = 'SUCCEEDED';
  if v_existing then
    select * into v_ledger from public.commercial_ledger_transactions
      where idempotency_key = 'tailor-adjustment-release:' || p_adjustment_id::text;
    if v_ledger.id is null or v_ledger.order_id::text <> v_order_id
      or v_ledger.payment_id <> v_payment.id
      or v_ledger.provider_reference <> p_provider_transfer_id
      or v_ledger.original_amount <> v_claim.amount
      or v_ledger.original_currency <> v_claim.currency
      or v_ledger.metadata->>'claimId' <> p_claim_id::text
      or v_ledger.metadata->>'payoutId' <> v_payout.id::text then
      raise exception 'Completed adjustment payout journal needs reconciliation';
    end if;
    v_ledger_id := v_ledger.id;
  else
    select coalesce(sum(case when e.direction = 'CREDIT' then e.amount else -e.amount end), 0)
      into v_entitlement
      from public.commercial_ledger_transactions t
      join public.commercial_ledger_entries e on e.transaction_id = t.id
      where t.payment_id = v_payment.id and t.order_id::text = v_order_id
        and e.account_code = 'TAILOR_ENTITLEMENT' and e.currency = v_claim.currency;
    v_entitlement_debit := least(greatest(v_entitlement, 0), v_claim.amount);
    v_subsidy := v_claim.amount - v_entitlement_debit;
    v_review_needed := v_review_needed or v_subsidy > 0;
    v_entries := '[]'::jsonb;
    if v_entitlement_debit > 0 then
      v_entries := v_entries || jsonb_build_array(jsonb_build_object(
        'accountCode', 'TAILOR_ENTITLEMENT', 'accountScope', 'order-adjustment',
        'direction', 'DEBIT', 'amount', v_entitlement_debit, 'currency', v_claim.currency));
    end if;
    if v_subsidy > 0 then
      v_entries := v_entries || jsonb_build_array(jsonb_build_object(
        'accountCode', 'DRAPEON_SUBSIDY_EXPENSE',
        'accountScope', 'adjustment:' || p_adjustment_id::text,
        'direction', 'DEBIT', 'amount', v_subsidy, 'currency', v_claim.currency));
    end if;
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'accountCode', 'TAILOR_RELEASED', 'accountScope', v_order_id,
      'direction', 'CREDIT', 'amount', v_claim.amount, 'currency', v_claim.currency));
    v_ledger_id := public.post_commercial_ledger_transaction(
      'tailor-adjustment-release:' || p_adjustment_id::text,
      'ADJUSTMENT', 'TAILOR_ADJUSTMENT_RELEASE', v_order_id, v_payment.id,
      v_adjustment.tailor_release_policy_version, 1, v_adjustment.correlation_id,
      p_provider_transfer_id, v_entries,
      jsonb_build_object('adjustmentId', p_adjustment_id, 'claimId', p_claim_id,
        'payoutId', v_payout.id, 'moneyDeskRequestId', v_request.id,
        'drapeonFundedAmount', v_subsidy), null, null, 'SYSTEM',
      v_claim.currency, v_claim.amount, v_claim.currency, v_claim.amount, 1, 0);
  end if;
  select coalesce(sum(e.amount) filter (where e.direction = 'DEBIT'
      and e.account_code in ('TAILOR_ENTITLEMENT', 'DRAPEON_SUBSIDY_EXPENSE')), 0),
    coalesce(sum(e.amount) filter (where e.direction = 'CREDIT'
      and e.account_code = 'TAILOR_RELEASED'), 0), count(*)
    into v_debit, v_credit, v_entry_count
    from public.commercial_ledger_entries e where e.transaction_id = v_ledger_id;
  if v_debit <> v_claim.amount or v_credit <> v_claim.amount or v_entry_count not in (2, 3) then
    raise exception 'Adjustment transfer journal is not the exact earned amount';
  end if;
  update public.payout_claims set payout_ledger_transaction_id = v_ledger_id,
    withdrawal_status = 'NOT_APPLICABLE'
    where id = p_claim_id and (payout_ledger_transaction_id is null
      or payout_ledger_transaction_id = v_ledger_id);
  if not found then raise exception 'Payout ledger receipt conflicts with its claim'; end if;
  update public.payout_provider_operations set status = case when status = 'WITHDRAWN'
      then 'WITHDRAWN' else 'TRANSFERRED' end,
    provider_transfer_id = p_provider_transfer_id
    where id = v_provider_operation.id;
  update public.payouts set status = 'PROCESSING'::public.payout_status,
    provider_payout_id = p_provider_transfer_id,
    provider_transfer_status = 'AVAILABLE_IN_PROVIDER_BALANCE',
    bank_settlement_status = 'NOT_APPLICABLE',
    provider_response = coalesce(provider_response, '{}'::jsonb) ||
      jsonb_build_object('claim_id', p_claim_id, 'ledger_id', v_ledger_id,
        'provider_transfer_id', p_provider_transfer_id)
    where id = v_payout.id;
  update public.adjustment_money_operation_claims set status = 'SUCCEEDED',
    provider_operation_id = p_provider_transfer_id,
    provider_evidence = v_attempt.provider_evidence,
    provider_checked_at = coalesce(provider_checked_at, now()),
    terminal_at = coalesce(terminal_at, now()) where id = v_operation.id;
  if v_review_needed then
    insert into public.ops_issues(issue_type, severity, status, source, order_id,
      related_entity_type, related_entity_id, provider, title, description,
      recommended_action, dedupe_key, metadata)
    values ('PAYOUT_LATE_SUCCESS', 'HIGH', 'OPEN', 'reviewed-adjustment-finalizer',
      v_order_id, 'PAYOUT_CLAIM', p_claim_id::text, v_claim.provider,
      'Adjustment transfer confirmed during a review change',
      'A confirmed transfer was recorded after its Money Desk or refund state changed.',
      'Reconcile the transfer, customer refund and accepted tailor earning.',
      'adjustment-transfer-review:' || p_adjustment_id::text,
      jsonb_build_object('adjustment_id', p_adjustment_id, 'claim_id', p_claim_id,
        'payout_id', v_payout.id, 'provider_transfer_id', p_provider_transfer_id))
    on conflict (dedupe_key) do update set status = 'OPEN', last_seen_at = now();
  end if;
  return jsonb_build_object('outcome', case when v_existing then 'EXISTING' else 'COMPLETED' end,
    'adjustment_id', p_adjustment_id, 'claim_id', p_claim_id,
    'payout_id', v_payout.id, 'ledger_id', v_ledger_id,
    'provider_transfer_id', p_provider_transfer_id, 'review_needed', v_review_needed);
end;
$$;

revoke all on function public.finalize_reviewed_adjustment_transfer(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.finalize_reviewed_adjustment_transfer(uuid, uuid, text)
  to service_role;

-- Snapshot the already-disclosed reviewed release rule atomically with
-- counterpart acceptance. Fabric/material and fulfillment allocations do not
-- become tailor earnings through this policy.
create or replace function public.guard_commercial_adjustment_release_policy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.tailor_release_policy_version is not distinct from new.tailor_release_policy_version then
    return new;
  end if;
  if old.tailor_release_policy_version is not null
    or new.tailor_release_policy_version is distinct from 'tailor-adjustment-delivery-72h-reviewed-v1'
    or old.status <> 'PROPOSED'
    or new.status <> 'PAYMENT_PENDING'
    or new.decided_at is null
    or new.decided_by is null
    or not new.requires_payment
    or new.amount_delta <= 0
    or new.responsibility <> 'CUSTOMER'
    or new.adjustment_type not in ('SCOPE','RUSH_WORK','FIT_REVISION','CORRECTION','OTHER_REVIEWED')
    or exists (select 1 from public.fabric_release_adjustment_links f where f.adjustment_id = new.id) then
    raise exception 'Reviewed tailor adjustment release policy can only be snapshotted at eligible acceptance';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_commercial_adjustment_release_policy()
  from public, anon, authenticated, service_role;
drop trigger if exists commercial_adjustment_release_policy_guard on public.commercial_adjustments;
create trigger commercial_adjustment_release_policy_guard
  before update of tailor_release_policy_version on public.commercial_adjustments
  for each row execute function public.guard_commercial_adjustment_release_policy();

create or replace function public.respond_commercial_adjustment(
  p_adjustment_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_decision text,
  p_note text default null
)
returns public.commercial_adjustments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.commercial_adjustments%rowtype;
  v_next_status text;
  v_release_policy text;
begin
  if p_decision not in ('ACCEPTED','DECLINED','CANCELLED') then
    raise exception 'Invalid adjustment decision.';
  end if;
  select * into v_row from public.commercial_adjustments where id = p_adjustment_id for update;
  if v_row.id is null then raise exception 'Adjustment was not found.'; end if;
  if v_row.status <> 'PROPOSED' then raise exception 'Adjustment is no longer awaiting a decision.'; end if;
  if p_decision = 'CANCELLED' then
    if v_row.proposed_by::text <> p_actor_id::text then raise exception 'Only the proposer can cancel this adjustment.'; end if;
  elsif v_row.counterparty_id::text <> p_actor_id::text then
    raise exception 'Only the counterpart can decide this adjustment.';
  end if;
  if p_actor_role not in ('CUSTOMER','TAILOR','OPS') then raise exception 'Invalid adjustment actor role.'; end if;

  v_next_status := case when p_decision = 'ACCEPTED' and v_row.requires_payment then 'PAYMENT_PENDING' else p_decision end;
  if p_decision = 'ACCEPTED' and v_row.requires_payment
    and v_row.amount_delta > 0
    and v_row.responsibility = 'CUSTOMER'
    and v_row.adjustment_type in ('SCOPE','RUSH_WORK','FIT_REVISION','CORRECTION','OTHER_REVIEWED')
    and not exists (select 1 from public.fabric_release_adjustment_links f where f.adjustment_id = v_row.id) then
    v_release_policy := 'tailor-adjustment-delivery-72h-reviewed-v1';
  end if;

  update public.commercial_adjustments
    set status = v_next_status,
      decided_at = now(),
      decided_by = p_actor_id,
      tailor_release_policy_version = v_release_policy
    where id = v_row.id
    returning * into v_row;

  if p_decision = 'ACCEPTED' and v_row.proposed_deadline is not null then
    update public.orders set deadline = v_row.proposed_deadline where id::text = v_row.order_id::text;
  end if;

  insert into public.commercial_adjustment_events(adjustment_id,event_type,actor_id,actor_role,payload,correlation_id)
  values (v_row.id,p_decision,p_actor_id,p_actor_role,
    jsonb_build_object('note',nullif(trim(coalesce(p_note,'')),''),'nextStatus',v_next_status,
      'tailorReleasePolicyVersion',v_row.tailor_release_policy_version),v_row.correlation_id);
  insert into public.financial_case_events(case_id,event_type,actor_id,actor_role,payload,correlation_id)
  values (v_row.financial_case_id,'COUNTERPARTY_RESPONSE_ADDED',p_actor_id,p_actor_role,
    jsonb_build_object('decision',p_decision,'note',nullif(trim(coalesce(p_note,'')),'')),v_row.correlation_id);

  update public.financial_cases
    set status = case when v_next_status = 'PAYMENT_PENDING' then 'OPS_REVIEW' else 'RESOLVED' end,
      counterparty_responded_at = now(),
      resolved_at = case when v_next_status = 'PAYMENT_PENDING' then null else now() end,
      resolved_by = case when v_next_status = 'PAYMENT_PENDING' then null else p_actor_id end,
      resolution_code = case when v_next_status = 'PAYMENT_PENDING' then null else p_decision end,
      resolution_summary = case when v_next_status = 'PAYMENT_PENDING' then null else coalesce(nullif(trim(coalesce(p_note,'')),''), p_decision) end,
      money_movement_blocked = v_next_status = 'PAYMENT_PENDING'
    where id = v_row.financial_case_id;
  return v_row;
end;
$$;

revoke all on function public.respond_commercial_adjustment(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.respond_commercial_adjustment(uuid, uuid, text, text, text)
  to service_role;

-- A later alteration made after the garment's original delivery needs its own
-- receipt evidence. Record a customer confirmation against the exact amendment;
-- do not reuse the order's one-per-milestone settlement evidence row.
create table if not exists public.tailor_adjustment_delivery_confirmations (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null unique references public.commercial_adjustments(id) on delete restrict,
  order_id text not null references public.orders(id_text) on delete restrict,
  customer_id uuid not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create or replace function public.validate_tailor_adjustment_delivery_confirmation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_adjustment public.commercial_adjustments%rowtype;
begin
  select * into v_adjustment from public.commercial_adjustments
    where id = new.adjustment_id for share;
  if v_adjustment.id is null or v_adjustment.order_id is distinct from new.order_id
    or v_adjustment.customer_id is distinct from new.customer_id::text
    or v_adjustment.status <> 'COMPLETED'
    or v_adjustment.decided_at is null
    or v_adjustment.tailor_release_policy_version is distinct from
      'tailor-adjustment-delivery-72h-reviewed-v1'
    or new.received_at < v_adjustment.decided_at then
    raise exception 'Adjustment delivery confirmation does not match completed customer work';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_tailor_adjustment_delivery_confirmation()
  from public, anon, authenticated, service_role;
drop trigger if exists tailor_adjustment_delivery_confirmation_validate
  on public.tailor_adjustment_delivery_confirmations;
create trigger tailor_adjustment_delivery_confirmation_validate
  before insert on public.tailor_adjustment_delivery_confirmations
  for each row execute function public.validate_tailor_adjustment_delivery_confirmation();

alter table public.tailor_adjustment_delivery_confirmations enable row level security;
revoke all on public.tailor_adjustment_delivery_confirmations from public, anon;
revoke all on public.tailor_adjustment_delivery_confirmations from service_role;
revoke insert, update, delete, truncate on public.tailor_adjustment_delivery_confirmations
  from authenticated;
grant select on public.tailor_adjustment_delivery_confirmations to authenticated;
grant select, insert on public.tailor_adjustment_delivery_confirmations to service_role;
revoke update, delete, truncate on public.tailor_adjustment_delivery_confirmations from service_role;
drop policy if exists "Order parties read tailor adjustment delivery confirmations"
  on public.tailor_adjustment_delivery_confirmations;
create policy "Order parties read tailor adjustment delivery confirmations"
  on public.tailor_adjustment_delivery_confirmations for select to authenticated
  using (exists (
    select 1 from public.commercial_adjustments a
      where a.id = tailor_adjustment_delivery_confirmations.adjustment_id
        and a.order_id = tailor_adjustment_delivery_confirmations.order_id
        and (a.customer_id = auth.uid()::text or a.tailor_id = auth.uid()::text)
  ));

create or replace function public.tailor_adjustment_release_gate(p_adjustment_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_adjustment public.commercial_adjustments%rowtype;
  v_payment public.order_payments%rowtype;
  v_plan public.order_settlement_plans%rowtype;
  v_evidence public.order_settlement_evidence%rowtype;
  v_confirmation public.tailor_adjustment_delivery_confirmations%rowtype;
  v_prior_evidence boolean;
  v_open_review boolean;
  v_eligible_at timestamptz;
  v_evidence_id uuid;
  v_evidence_at timestamptz;
begin
  select * into v_adjustment from public.commercial_adjustments where id=p_adjustment_id;
  if v_adjustment.id is null then return jsonb_build_object('state','NOT_FOUND'); end if;
  if v_adjustment.tailor_release_policy_version is distinct from
      'tailor-adjustment-delivery-72h-reviewed-v1' then
    return jsonb_build_object('state','UNSUPPORTED_POLICY');
  end if;
  if v_adjustment.status not in ('PAID','COMPLETED')
    or v_adjustment.decided_at is null or v_adjustment.payment_id is null then
    return jsonb_build_object('state','WAITING_PAYMENT');
  end if;

  select * into v_payment from public.order_payments where id=v_adjustment.payment_id;
  if v_payment.id is null or v_payment.order_id::text <> v_adjustment.order_id
    or v_payment.phase::text <> 'ADJUSTMENT'
    or v_payment.currency is distinct from v_adjustment.currency
    or v_payment.status::text <> 'SUCCEEDED'
    or v_payment.amount < v_adjustment.amount_delta
    or v_payment.provider_payment_id is null or v_payment.ledger_recorded_at is null
    or v_payment.confirmed_at is null then
    return jsonb_build_object('state','WAITING_PAYMENT');
  end if;
  if coalesce(v_payment.refunded_amount,0) > 0 then
    return jsonb_build_object('state','BLOCKED_REFUND');
  end if;

  select * into v_plan from public.order_settlement_plans where order_id=v_adjustment.order_id;
  if v_plan.id is null or v_plan.policy_version <> 'settlement-2026-08-01-v1'
    or v_plan.currency is distinct from v_adjustment.currency then
    return jsonb_build_object('state','NO_PROVEN_SETTLEMENT_PLAN');
  end if;
  if v_plan.status not in ('ACTIVE','SETTLED') then
    return jsonb_build_object('state','BLOCKED_REVIEW');
  end if;

  select exists (select 1 from public.disputes d
      where d.order_id::text=v_adjustment.order_id and d.status::text in ('OPEN','UNDER_REVIEW'))
    or exists (select 1 from public.provider_disputes d
      where d.order_id=v_adjustment.order_id and d.money_movement_blocked)
    or exists (select 1 from public.financial_cases c
      where c.order_id=v_adjustment.order_id and c.status not in ('RESOLVED','CLOSED','CANCELLED'))
    or exists (select 1 from public.order_payment_refund_claims r
      where r.order_id=v_adjustment.order_id
        and r.status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING'))
    into v_open_review;
  if v_open_review then return jsonb_build_object('state','BLOCKED_REVIEW'); end if;

  select * into v_evidence from public.order_settlement_evidence e
    where e.plan_id=v_plan.id and e.occurred_at >= v_adjustment.decided_at
      and e.evidence_kind = case v_plan.method
        when 'SHIPPED' then 'VERIFIED_DELIVERY'
        when 'LOCAL_HANDOFF' then 'AUTHENTICATED_LOCAL_HANDOFF'
        else 'UNSUPPORTED' end
      and ((e.evidence_kind='VERIFIED_DELIVERY'
            and e.source in ('TRUSTED_CARRIER','CUSTOMER_CONFIRMATION','DRAPEON_OPS'))
        or (e.evidence_kind='AUTHENTICATED_LOCAL_HANDOFF' and e.source='COLLECTION_CODE'))
    order by e.occurred_at,e.id limit 1;
  if v_evidence.id is not null then
    v_evidence_id := v_evidence.id;
    v_evidence_at := v_evidence.occurred_at;
  else
    select exists (select 1 from public.order_settlement_evidence e
      where e.plan_id=v_plan.id and e.evidence_kind in ('VERIFIED_DELIVERY','AUTHENTICATED_LOCAL_HANDOFF')
        and e.occurred_at < v_adjustment.decided_at) into v_prior_evidence;
    if not v_prior_evidence then
      return jsonb_build_object('state','WAITING_DELIVERY');
    end if;
    select * into v_confirmation from public.tailor_adjustment_delivery_confirmations c
      where c.adjustment_id=v_adjustment.id and c.order_id=v_adjustment.order_id
        and c.customer_id::text=v_adjustment.customer_id
        and c.received_at >= v_adjustment.decided_at;
    if v_confirmation.id is null then
      return jsonb_build_object('state','NEEDS_ADJUSTMENT_HANDOFF');
    end if;
    v_evidence_id := v_confirmation.id;
    v_evidence_at := v_confirmation.received_at;
  end if;

  v_eligible_at := greatest(v_evidence_at + interval '72 hours',v_payment.confirmed_at);
  return jsonb_build_object('state',case when now() < v_eligible_at
      then 'WAITING_72H' else 'READY_FOR_MONEY_DESK' end,
    'eligible_at',v_eligible_at,'evidence_id',v_evidence_id,
    'payment_id',v_payment.id,'review_required',true);
end;
$$;
revoke all on function public.tailor_adjustment_release_gate(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.tailor_adjustment_release_gate(uuid) to service_role;

create or replace function public.confirm_tailor_adjustment_delivery(
  p_adjustment_id uuid, p_customer_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_adjustment public.commercial_adjustments%rowtype;
  v_confirmation public.tailor_adjustment_delivery_confirmations%rowtype;
  v_gate jsonb;
begin
  if p_adjustment_id is null or p_customer_id is null then
    raise exception 'Adjustment and customer identity are required';
  end if;
  select * into v_adjustment from public.commercial_adjustments
    where id=p_adjustment_id for update;
  if v_adjustment.id is null or v_adjustment.customer_id is distinct from p_customer_id::text
    or v_adjustment.status <> 'COMPLETED'
    or v_adjustment.tailor_release_policy_version is distinct from
      'tailor-adjustment-delivery-72h-reviewed-v1' then
    raise exception 'A completed reviewed tailor adjustment can be confirmed only by its customer';
  end if;
  select * into v_confirmation from public.tailor_adjustment_delivery_confirmations
    where adjustment_id=v_adjustment.id;
  if v_confirmation.id is not null then
    if v_confirmation.order_id <> v_adjustment.order_id
      or v_confirmation.customer_id <> p_customer_id then
      raise exception 'Adjustment delivery confirmation identity conflicts';
    end if;
    return jsonb_build_object('outcome','EXISTING','confirmation_id',v_confirmation.id,
      'received_at',v_confirmation.received_at);
  end if;
  v_gate := public.tailor_adjustment_release_gate(v_adjustment.id);
  if v_gate->>'state' <> 'NEEDS_ADJUSTMENT_HANDOFF' then
    raise exception 'Separate adjustment delivery confirmation is not required';
  end if;
  insert into public.tailor_adjustment_delivery_confirmations(
    adjustment_id,order_id,customer_id,received_at
  ) values (v_adjustment.id,v_adjustment.order_id,p_customer_id,clock_timestamp())
  on conflict (adjustment_id) do nothing
  returning * into v_confirmation;
  if v_confirmation.id is null then
    select * into v_confirmation from public.tailor_adjustment_delivery_confirmations
      where adjustment_id=v_adjustment.id;
    if v_confirmation.order_id <> v_adjustment.order_id
      or v_confirmation.customer_id <> p_customer_id then
      raise exception 'Concurrent adjustment delivery confirmation identity conflicts';
    end if;
    return jsonb_build_object('outcome','EXISTING','confirmation_id',v_confirmation.id,
      'received_at',v_confirmation.received_at);
  end if;
  insert into public.commercial_adjustment_events(
    adjustment_id,event_type,actor_id,actor_role,payload,correlation_id
  ) values (v_adjustment.id,'NOTE_ADDED',p_customer_id,'CUSTOMER',
    jsonb_build_object('event','ADJUSTMENT_DELIVERY_CONFIRMED',
      'deliveryConfirmationId',v_confirmation.id,'receivedAt',v_confirmation.received_at),
    v_adjustment.correlation_id);
  return jsonb_build_object('outcome','CONFIRMED','confirmation_id',v_confirmation.id,
    'received_at',v_confirmation.received_at);
end;
$$;
revoke all on function public.confirm_tailor_adjustment_delivery(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_tailor_adjustment_delivery(uuid,uuid) to service_role;
