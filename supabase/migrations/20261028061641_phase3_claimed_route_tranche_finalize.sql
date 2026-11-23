-- Dev applied version 20261028061641. Final settlement of an accepted staged
-- order is a narrow trusted write.
-- The plan/claims/ledger must all reconcile before escrow_released can change.

-- Keep the transaction-bound marker records used by the terminal-order guard.
-- The legacy marker table is retained for existing legacy releasers; staged
-- escrow has one writer below and its row is created in the same transaction.
create schema if not exists payment_internal;

create table if not exists payment_internal.legacy_escrow_writes (
  order_id text not null,
  claim_id uuid not null,
  payout_id text not null,
  ledger_id uuid not null,
  transaction_id bigint not null,
  backend_pid integer not null,
  created_at timestamp(3) without time zone not null,
  primary key (order_id)
);
alter table payment_internal.legacy_escrow_writes enable row level security;
revoke all on payment_internal.legacy_escrow_writes from public,anon,authenticated,service_role;

create table if not exists payment_internal.staged_escrow_writes (
  order_id text not null,
  plan_id uuid not null,
  event_id uuid not null,
  transaction_id bigint not null,
  backend_pid integer not null,
  created_at timestamptz not null,
  primary key (order_id)
);
alter table payment_internal.staged_escrow_writes enable row level security;
revoke all on payment_internal.staged_escrow_writes from public,anon,authenticated,service_role;

create or replace function private.staged_settlement_escrow_release_ready(
  p_order_id text,
  p_plan_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_plan public.order_settlement_plans%rowtype;
  v_tranche_count integer;
  v_tranche_amount bigint;
  v_claim_amount bigint;
  v_ledger_amount bigint;
  v_ledger_debit_amount bigint;
  v_credit_entry_count integer;
  v_debit_entry_count integer;
begin
  select * into v_order from public.orders where id=p_order_id;
  select * into v_plan from public.order_settlement_plans where id=p_plan_id;
  if v_order.id is null or v_plan.id is null
    or v_plan.order_id is distinct from p_order_id
    or v_order.commercial_policy_version is distinct from 'commercial-2026-07-31-v1'
    or v_order.stage is distinct from 'COMPLETE'::public.order_stage
    or v_plan.status is distinct from 'SETTLED'
    or v_order.accepted_earning_amount is distinct from v_plan.entitlement_amount
    or v_order.tailor_payout_currency_locked is distinct from v_plan.currency then
    return false;
  end if;

  select count(*), coalesce(sum(t.amount),0)
    into v_tranche_count,v_tranche_amount
    from public.order_settlement_tranches t where t.plan_id=p_plan_id;
  if v_tranche_count=0 or v_tranche_amount<>v_plan.entitlement_amount
    or exists (select 1 from public.order_settlement_tranches t
      where t.plan_id=p_plan_id and t.currency is distinct from v_plan.currency)
    or exists (
      select 1 from public.order_settlement_tranches t
      left join public.payout_claims c
        on c.business_key='tranche:'||t.id::text
       and c.source_kind='SETTLEMENT_TRANCHE'
       and c.source_id=t.id::text
       and c.order_id=p_order_id
      left join public.payouts p on p.id=c.payout_id
      left join lateral (
        select op.* from public.payout_provider_operations op
        where op.claim_id=c.id order by op.operation_number desc limit 1
      ) op on true
      where t.plan_id=p_plan_id
        and (t.status<>'RELEASED'
          or t.release_ledger_transaction_id is null
          or t.payout_id is distinct from c.payout_id
          or c.id is null
          or c.status not in ('TRANSFERRED','WITHDRAWN')
          or c.transfer_status<>'CONFIRMED'
          or c.provider_transfer_id is null
          or c.payout_ledger_transaction_id is distinct from t.release_ledger_transaction_id
          or c.amount is distinct from t.amount
          or c.currency is distinct from t.currency
          or p.id is null
          or p.settlement_tranche_id is distinct from t.id
          or p.order_id is distinct from p_order_id
          or p.provider::text is distinct from c.provider
          or p.provider_transfer_status is distinct from 'AVAILABLE_IN_PROVIDER_BALANCE'
          or p.bank_settlement_status is distinct from 'NOT_APPLICABLE'
          or p.amount is distinct from c.amount
          or p.currency is distinct from c.currency
          or p.provider_destination_id is distinct from op.provider_destination_id
          or p.provider_payout_id is distinct from c.provider_transfer_id
          or op.status not in ('TRANSFERRED','WITHDRAWN')
          or op.provider is distinct from c.provider
          or op.amount is distinct from c.amount
          or op.currency is distinct from c.currency
          or op.provider_transfer_id is distinct from c.provider_transfer_id)
    ) then
    return false;
  end if;

  -- The approved policy is immutable: do not let a corrupted schedule with a
  -- matching sum silently change which amount is released at each milestone.
  if (v_plan.method='SHIPPED' and (
      v_tranche_count<>3
      or exists(select 1 from public.order_settlement_tranches t
        where t.plan_id=p_plan_id and not (
          (t.sequence=1 and t.code='SHIP_CUSTODY_70' and t.basis_points=7000
            and t.amount=v_plan.entitlement_amount
              -(v_plan.entitlement_amount::bigint*2000/10000)::integer
              -(v_plan.entitlement_amount::bigint*1000/10000)::integer)
          or (t.sequence=2 and t.code='SHIP_DELIVERY_20' and t.basis_points=2000
            and t.amount=(v_plan.entitlement_amount::bigint*2000/10000)::integer)
          or (t.sequence=3 and t.code='SHIP_PROTECTION_10' and t.basis_points=1000
            and t.amount=(v_plan.entitlement_amount::bigint*1000/10000)::integer)
        ))))
    or (v_plan.method='LOCAL_HANDOFF' and (
      v_tranche_count<>2
      or exists(select 1 from public.order_settlement_tranches t
        where t.plan_id=p_plan_id and not (
          (t.sequence=1 and t.code='LOCAL_HANDOFF_80' and t.basis_points=8000
            and t.amount=v_plan.entitlement_amount
              -(v_plan.entitlement_amount::bigint*2000/10000)::integer)
          or (t.sequence=2 and t.code='LOCAL_SETTLED_20' and t.basis_points=2000
            and t.amount=(v_plan.entitlement_amount::bigint*2000/10000)::integer)
        ))))
    or v_plan.method not in ('SHIPPED','LOCAL_HANDOFF') then
    return false;
  end if;

  select coalesce(sum(c.amount),0) into v_claim_amount
    from public.order_settlement_tranches t
    join public.payout_claims c
      on c.business_key='tranche:'||t.id::text
     and c.source_kind='SETTLEMENT_TRANCHE'
     and c.source_id=t.id::text
     and c.order_id=p_order_id
    where t.plan_id=p_plan_id;
  if v_claim_amount<>v_plan.entitlement_amount then return false; end if;

  select coalesce(sum(e.amount) filter (where e.account_code='TAILOR_RELEASED'
             and e.direction='CREDIT'),0),
         coalesce(sum(e.amount) filter (where e.account_code='TAILOR_ELIGIBLE'
             and e.direction='DEBIT'),0),
         count(*) filter (where e.account_code='TAILOR_RELEASED'
             and e.direction='CREDIT'),
         count(*) filter (where e.account_code='TAILOR_ELIGIBLE'
             and e.direction='DEBIT')
    into v_ledger_amount,v_ledger_debit_amount,v_credit_entry_count,v_debit_entry_count
    from public.order_settlement_tranches t
    join public.commercial_ledger_entries e
      on e.transaction_id=t.release_ledger_transaction_id
     and e.order_id=p_order_id and e.currency=t.currency and e.amount=t.amount
    join public.commercial_ledger_transactions l
      on l.id=e.transaction_id
     and l.order_id=p_order_id
     and l.transaction_kind='ADJUSTMENT'
     and l.purpose='SETTLEMENT_RELEASE'
     and l.payment_id=v_plan.source_payment_id
     and l.provider_reference is not distinct from t.provider_reference
    where t.plan_id=p_plan_id;
  if v_ledger_amount<>v_plan.entitlement_amount
    or v_ledger_debit_amount<>v_plan.entitlement_amount
    or v_credit_entry_count<>v_tranche_count
    or v_debit_entry_count<>v_tranche_count then return false; end if;

  if exists (
      select 1 from public.disputes d
      where d.order_id=p_order_id and d.status::text in ('OPEN','UNDER_REVIEW')
    ) or exists (
      select 1 from public.provider_disputes d
      where d.order_id=p_order_id and d.money_movement_blocked is true
    ) or exists (
      select 1 from public.financial_cases c
      where c.order_id=p_order_id and c.money_movement_blocked is true
        and c.status not in ('RESOLVED','CLOSED','CANCELLED')
    ) or exists (
      select 1 from public.order_payment_refund_claims r
      where r.order_id=p_order_id
        and r.status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING')
    ) or exists (
      select 1 from public.payout_claims c
      left join public.payout_provider_operations op on op.claim_id=c.id
      where c.order_id=p_order_id
        and (c.status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING')
          or op.status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING'))
    ) then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function private.staged_settlement_escrow_release_ready(text,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.finalize_staged_settlement_escrow_release(
  p_order_id text,
  p_plan_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_plan public.order_settlement_plans%rowtype;
  v_tranche_count integer;
  v_tranche_ids uuid[];
  v_claim_ids uuid[];
  v_ledger_ids uuid[];
  v_event_id uuid;
  v_created_at timestamp(3) without time zone := now()::timestamp(3);
begin
  select * into v_order from public.orders where id=p_order_id for update;
  select * into v_plan from public.order_settlement_plans where id=p_plan_id for update;
  if v_order.id is null or v_plan.id is null or v_plan.order_id is distinct from p_order_id then
    raise exception 'Staged settlement order and plan do not match';
  end if;
  if v_order.escrow_released is true then
    return jsonb_build_object('outcome','EXISTING','order_id',p_order_id,'plan_id',p_plan_id);
  end if;
  if not private.staged_settlement_escrow_release_ready(p_order_id,p_plan_id) then
    return jsonb_build_object('outcome','BLOCKED','order_id',p_order_id,'plan_id',p_plan_id);
  end if;

  select array_agg(t.id order by t.sequence),
         array_agg(c.id order by t.sequence),
         array_agg(t.release_ledger_transaction_id order by t.sequence)
    into v_tranche_ids,v_claim_ids,v_ledger_ids
    from public.order_settlement_tranches t
    join public.payout_claims c on c.business_key='tranche:'||t.id::text
      and c.source_kind='SETTLEMENT_TRANCHE' and c.source_id=t.id::text
      and c.order_id=p_order_id
    where t.plan_id=p_plan_id;
  select count(*) into v_tranche_count from public.order_settlement_tranches
    where plan_id=p_plan_id;
  if v_tranche_ids is null or cardinality(v_tranche_ids)<>v_tranche_count
    or cardinality(v_claim_ids)<>v_tranche_count
    or cardinality(v_ledger_ids)<>v_tranche_count then
    raise exception 'Staged settlement audit identities do not reconcile';
  end if;
  insert into public.order_settlement_events(plan_id,event_type,actor_role,payload,correlation_id)
  values (p_plan_id,'PLAN_ESCROW_RELEASED','SYSTEM',
    jsonb_build_object('order_id',p_order_id,'tranche_ids',v_tranche_ids,
      'claim_ids',v_claim_ids,'release_ledger_ids',v_ledger_ids),v_plan.correlation_id)
  returning id into v_event_id;
  insert into payment_internal.staged_escrow_writes
    (order_id,plan_id,event_id,transaction_id,backend_pid,created_at)
  values (p_order_id,p_plan_id,v_event_id,txid_current(),pg_backend_pid(),v_created_at);
  update public.orders set escrow_released=true,
    escrow_released_at=v_created_at,updated_at=now()
    where id=p_order_id and escrow_released is false;
  if not found then raise exception 'Staged settlement escrow marker changed concurrently'; end if;
  return jsonb_build_object('outcome','COMPLETED','order_id',p_order_id,'plan_id',p_plan_id);
end;
$$;

revoke all on function public.finalize_staged_settlement_escrow_release(text,uuid)
  from public,anon,authenticated;
grant execute on function public.finalize_staged_settlement_escrow_release(text,uuid)
  to service_role;

-- Preserve the previous internal entrypoint but route every staged marker
-- write through the single reconciled writer above.
create or replace function public.mark_confirmed_staged_escrow_released(p_order_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan_id uuid;
begin
  select id into v_plan_id from public.order_settlement_plans
    where order_id=p_order_id;
  if v_plan_id is null then raise exception 'Staged escrow settlement plan is missing'; end if;
  return public.finalize_staged_settlement_escrow_release(p_order_id,v_plan_id);
end;
$$;
revoke all on function public.mark_confirmed_staged_escrow_released(text)
  from public,anon,authenticated;
grant execute on function public.mark_confirmed_staged_escrow_released(text)
  to service_role;

-- Terminal orders may only receive this exact false->true marker via the
-- reconciled staged-settlement function; the existing destination exception is
-- preserved without broadening its allowed field set.
create or replace function public.guard_terminal_order_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destination_keys constant text[] := array[
    'tailor_paystack_recipient_code_locked',
    'tailor_stripe_connect_account_id_locked',
    'tailor_payout_provider_locked',
    'tailor_payout_currency_locked',
    'updated_at'
  ];
  v_escrow_keys constant text[] := array['escrow_released','escrow_released_at','updated_at'];
begin
  if old.stage='COMPLETE'::public.order_stage
    and new.stage in ('PARTIALLY_REFUNDED'::public.order_stage,'REFUNDED'::public.order_stage)
    and new.escrow_released is not distinct from old.escrow_released
    and new.escrow_released_at is not distinct from old.escrow_released_at then
    return new;
  end if;
  if public.is_terminal_order_stage(old.stage) then
    if current_setting('app.reviewed_payout_destination_correction',true)='on'
      and (to_jsonb(new)-v_destination_keys)=(to_jsonb(old)-v_destination_keys) then
      return new;
    end if;
    if old.escrow_released is false and new.escrow_released is true
      and old.escrow_released_at is null
      and new.escrow_released_at is not null
      and (to_jsonb(new)-v_escrow_keys)=(to_jsonb(old)-v_escrow_keys)
      and exists (select 1 from payment_internal.staged_escrow_writes w
        join public.order_settlement_events e on e.id=w.event_id
          and e.plan_id=w.plan_id and e.event_type='PLAN_ESCROW_RELEASED'
        where w.order_id=old.id and w.transaction_id=txid_current()
          and w.backend_pid=pg_backend_pid()
          and w.created_at::timestamp(3)=new.escrow_released_at
          and private.staged_settlement_escrow_release_ready(w.order_id,w.plan_id)) then
      return new;
    end if;
    -- Preserve the existing claim/payout/ledger-bound legacy escrow writer.
    if old.escrow_released is false and new.escrow_released is true
      and old.escrow_released_at is null and new.escrow_released_at is not null
      and (to_jsonb(new)-v_escrow_keys)=(to_jsonb(old)-v_escrow_keys)
      and exists (select 1 from payment_internal.legacy_escrow_writes w
        where w.order_id=old.id and w.transaction_id=txid_current()
          and w.backend_pid=pg_backend_pid()
          and w.created_at=new.escrow_released_at) then
      return new;
    end if;
    raise exception 'Terminal order % at stage % cannot be mutated.',old.id,old.stage
      using errcode='P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_terminal_order_update() from public,anon,authenticated;
grant execute on function public.guard_terminal_order_update() to service_role;

-- A tranche is provider-neutral after the immutable claim and provider
-- operation are reconciled. Stripe and Bachs transfers both end at the
-- provider balance; neither implies a bank withdrawal.
create or replace function public.finalize_claimed_route_tranche_release(
  p_claim_id uuid,
  p_payout_id text,
  p_provider_transfer_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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
    or v_payment.id is null or v_payment.status<>'SUCCEEDED'
    or coalesce(v_payment.refunded_amount,0)<>0;
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
$$;

revoke all on function public.finalize_claimed_route_tranche_release(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.finalize_claimed_route_tranche_release(uuid,text,text)
  to service_role;

-- Keep the old internal RPC name as a compatibility wrapper for the already
-- deployed Dev Bachs entrypoint while the caller rolls forward.
create or replace function public.finalize_claimed_bachs_tranche_release(
  p_claim_id uuid,p_payout_id text,p_provider_transfer_id text
)
returns jsonb language sql security invoker set search_path=''
as $$
  select public.finalize_claimed_route_tranche_release(
    p_claim_id,p_payout_id,p_provider_transfer_id
  );
$$;
revoke all on function public.finalize_claimed_bachs_tranche_release(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.finalize_claimed_bachs_tranche_release(uuid,text,text)
  to service_role;

-- This verification is intentionally metadata-only: provider transfers are
-- confirmed by the payout claim before the escrow writer can run.
do $$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.orders'::regclass
      and tgname='orders_terminal_guard' and not tgisinternal) then
    raise exception 'Terminal order guard is missing';
  end if;
  if has_function_privilege('anon','public.finalize_staged_settlement_escrow_release(text,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.finalize_staged_settlement_escrow_release(text,uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.finalize_staged_settlement_escrow_release(text,uuid)','EXECUTE') then
    raise exception 'Staged escrow finalizer grants are not service-only';
  end if;
end;
$$;
