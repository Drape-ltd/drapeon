-- Dev migration version: 20261028035153. Extend the existing immutable tranche reservation for accepted Bachs routes.
-- Stripe/legacy behavior remains unchanged; provider I/O stays outside this RPC.
create or replace function public.reserve_settlement_tranche_payout_row(
  p_tranche_id uuid,
  p_tailor_profile_id text,
  p_money_desk_request_id uuid,
  p_provider text,
  p_destination_id text,
  p_route_version text,
  p_tailor_terms_version text
)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
      or v_destination.currency::text is distinct from v_order.tailor_payout_currency_locked
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
    or v_payment.status<>'SUCCEEDED' or v_payment.ledger_recorded_at is null
    or v_payment.refunded_amount<>0
    or v_payment.currency is distinct from v_tranche.currency
    or v_payment.provider::text is distinct from p_provider;

  select * into v_claim from public.payout_claims
    where business_key=v_business_key for update;
  if not found then
    if v_source_changed then
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
end $$;

revoke execute on function public.reserve_settlement_tranche_payout_row(
  uuid,text,uuid,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.reserve_settlement_tranche_payout_row(
  uuid,text,uuid,text,text,text,text
) to service_role;

-- Bachs `paid` is a platform-to-connected-balance transfer, not a bank
-- withdrawal. Finalize the tranche ledger only after exact provider evidence.
create or replace function public.finalize_claimed_bachs_tranche_release(
  p_claim_id uuid,
  p_payout_id text,
  p_provider_transfer_id text
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_order_id text;
  v_tranche_id text;
  v_claim public.payout_claims%rowtype;
  v_tranche public.order_settlement_tranches%rowtype;
  v_plan public.order_settlement_plans%rowtype;
  v_payout public.payouts%rowtype;
  v_payment public.order_payments%rowtype;
  v_ledger_id uuid;
  v_review_needed boolean;
  v_remaining integer;
begin
  if p_provider_transfer_id !~ '^tr_[A-Za-z0-9_-]+$' then
    raise exception 'A confirmed Bachs transfer reference is required';
  end if;
  select order_id,source_id into v_order_id,v_tranche_id
    from public.payout_claims where id=p_claim_id;
  if v_order_id is null or v_tranche_id is null then
    raise exception 'Tranche release requires its exact confirmed Bachs claim';
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
    or v_claim.provider<>'BACHS'
    or v_claim.payout_id is distinct from p_payout_id
    or v_claim.status not in ('TRANSFERRED','WITHDRAWN')
    or v_claim.transfer_status<>'CONFIRMED'
    or v_claim.provider_transfer_id is distinct from p_provider_transfer_id then
    raise exception 'Tranche release requires its exact confirmed Bachs claim';
  end if;
  select * into v_payout from public.payouts where id=p_payout_id for update;
  if v_tranche.id is null or v_plan.order_id is distinct from v_order_id
    or v_plan.policy_version is distinct from v_claim.earning_policy_version
    or v_payout.id is null
    or v_payout.settlement_tranche_id is distinct from v_tranche.id
    or v_payout.order_id is distinct from v_claim.order_id
    or v_payout.tailor_profile_id is distinct from v_claim.tailor_profile_id
    or v_payout.source_payment_id is distinct from v_plan.source_payment_id
    or v_payout.provider::text is distinct from 'BACHS'
    or v_payout.provider_destination_id is distinct from v_claim.provider_destination_id
    or row(v_tranche.amount,v_tranche.currency)
       is distinct from row(v_claim.amount,v_claim.currency)
    or row(v_payout.amount,v_payout.currency)
       is distinct from row(v_claim.amount,v_claim.currency) then
    raise exception 'Claimed Bachs tranche payout does not match its accepted earning';
  end if;
  if v_tranche.status='RELEASED' then
    if v_tranche.payout_id is distinct from p_payout_id
      or v_tranche.provider_reference is distinct from p_provider_transfer_id
      or v_tranche.release_ledger_transaction_id is null
      or v_payout.provider_payout_id is distinct from p_provider_transfer_id
      or v_claim.payout_ledger_transaction_id is distinct from v_tranche.release_ledger_transaction_id then
      raise exception 'Released tranche conflicts with its confirmed transfer';
    end if;
    return jsonb_build_object('outcome','EXISTING','tranche_id',v_tranche.id,
      'payout_id',p_payout_id,'ledger_id',v_tranche.release_ledger_transaction_id,
      'provider_transfer_id',p_provider_transfer_id);
  end if;
  if v_tranche.status not in ('RELEASE_REQUESTED','BLOCKED','CANCELLED')
    or v_tranche.payout_id is distinct from p_payout_id then
    raise exception 'Tranche has no reserved release to complete';
  end if;
  if v_payout.provider_payout_id is distinct from p_provider_transfer_id then
    raise exception 'Bachs payout reference was not durably recorded before finalization';
  end if;
  v_review_needed := v_plan.status<>'ACTIVE'
    or v_tranche.status<>'RELEASE_REQUESTED'
    or v_payment.id is null or v_payment.status<>'SUCCEEDED'
    or v_payment.refunded_amount<>0;
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
      'payout_id',p_payout_id,'provider','BACHS'),null,null,'SYSTEM',v_tranche.currency,v_tranche.amount,
    v_tranche.currency,v_tranche.amount,1,0);
  update public.payout_claims set payout_ledger_transaction_id=v_ledger_id
    where id=p_claim_id and (payout_ledger_transaction_id is null
      or payout_ledger_transaction_id=v_ledger_id);
  if not found then raise exception 'Bachs payout ledger receipt conflicts with its claim'; end if;
  update public.payouts set status='PROCESSING',
    provider_transfer_status='AVAILABLE_IN_PROVIDER_BALANCE',
    bank_settlement_status='PENDING',completed_at=null,processed_at=now()
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
      'provider_terminal_status','paid','review_needed',v_review_needed),
    v_tranche.correlation_id);
  if v_review_needed then
    insert into public.ops_issues (
      issue_type,severity,status,source,order_id,related_entity_type,
      related_entity_id,provider,title,description,recommended_action,
      dedupe_key,metadata
    ) values (
      'PAYOUT_LATE_SUCCESS','HIGH','OPEN','bachs-transfer-reconcile',
      v_tranche.order_id,'SETTLEMENT_TRANCHE',v_tranche.id::text,'BACHS',
      'Tranche transfer confirmed during a payment or review change',
      'Bachs confirmed a tranche transfer after its source payment or settlement review changed. The transfer was recorded so real money is not lost.',
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
    update public.orders set escrow_released=true,escrow_released_at=now()
      where id=v_tranche.order_id;
  end if;
  return jsonb_build_object('outcome','COMPLETED','tranche_id',v_tranche.id,
    'payout_id',p_payout_id,'ledger_id',v_ledger_id,
    'provider_transfer_id',p_provider_transfer_id,
    'review_needed',v_review_needed);
end $$;

revoke execute on function public.finalize_claimed_bachs_tranche_release(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.finalize_claimed_bachs_tranche_release(uuid,text,text)
  to service_role;
