-- Forward-only closure for the TIP claim objects omitted from Production's Phase 1 history.
-- Keep historical migrations immutable; this restores the Dev-verified final
-- definitions without enabling any route or moving money.
-- Function bodies below match Dev's catalog on 2026-10-28. Production must
-- preflight that this table and its claim RPCs are absent before application.
create table if not exists public.tip_money_operation_claims (
  id uuid primary key default gen_random_uuid(),
  tip_id uuid not null references public.order_tips(id) on delete restrict,
  operation_kind text not null constraint tip_money_operation_claims_operation_kind_check
    check (operation_kind in ('PAYOUT','REFUND')),
  request_key text not null unique,
  status text not null default 'RESERVED' constraint tip_money_operation_claims_status_check
    check (status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING','SUCCEEDED','FAILED_RECONCILED','BLOCKED_IDENTITY')),
  refund_funding_mode text constraint tip_money_operation_claims_refund_funding_mode_check
    check (refund_funding_mode in ('UNPAID_TIP','POST_PAYOUT')),
  money_desk_request_id uuid references public.money_desk_requests(id) on delete restrict,
  provider text constraint tip_money_operation_claims_provider_nonempty
    check (provider is null or nullif(btrim(provider),'') is not null),
  provider_operation_id text,
  payout_id text references public.payouts(id_text) on delete restrict,
  payout_ledger_transaction_id uuid references public.commercial_ledger_transactions(id) on delete restrict,
  provider_response jsonb not null default '{}'::jsonb,
  provider_checked_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tip_money_operation_claims_tip_id_operation_kind_key unique (tip_id,operation_kind),
  constraint tip_money_operation_claims_check check (
    (operation_kind='PAYOUT' and money_desk_request_id is null and refund_funding_mode is null)
    or (operation_kind='REFUND' and money_desk_request_id is not null and refund_funding_mode is not null)
  ),
  constraint tip_money_operation_terminal_evidence check (
    status not in ('SUCCEEDED','FAILED_RECONCILED')
    or (provider_checked_at is not null and provider_response <> '{}'::jsonb)
  ),
  constraint tip_payout_ledger_on_payout_claim_only check (
    payout_ledger_transaction_id is null or operation_kind='PAYOUT'
  )
);

create index if not exists tip_money_operation_claims_status_idx
  on public.tip_money_operation_claims(status,created_at);
create index if not exists tip_money_operation_claims_money_desk_idx
  on public.tip_money_operation_claims(money_desk_request_id)
  where money_desk_request_id is not null;
create index if not exists tip_money_operation_claims_payout_idx
  on public.tip_money_operation_claims(payout_id)
  where payout_id is not null;
create unique index if not exists tip_money_operation_provider_reference_idx
  on public.tip_money_operation_claims(provider,provider_operation_id)
  where provider is not null and provider_operation_id is not null;
create unique index if not exists tip_money_payout_ledger_unique_idx
  on public.tip_money_operation_claims(payout_ledger_transaction_id)
  where payout_ledger_transaction_id is not null;

alter table public.tip_money_operation_claims enable row level security;
revoke all on public.tip_money_operation_claims from public,anon,authenticated;
grant select,insert,update on public.tip_money_operation_claims to service_role;

CREATE OR REPLACE FUNCTION public.guard_tip_refund_real_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request public.money_desk_requests%rowtype;
  v_tip public.order_tips%rowtype;
  v_approvers integer;
begin
  if new.operation_kind <> 'REFUND' then return new; end if;

  select * into v_tip from public.order_tips where id = new.tip_id;
  select * into v_request from public.money_desk_requests
    where id = new.money_desk_request_id;
  if v_tip.id is null or v_request.id is null
    or new.request_key <> 'DRAPE-TIP-REFUND-' || new.tip_id::text
    or v_request.action_type <> 'CUSTOMER_REFUND'
    or v_request.target_type <> 'ORDER_TIP'
    or v_request.target_id <> new.tip_id::text
    or v_request.order_id <> v_tip.order_id
    or v_request.amount <> v_tip.amount
    or v_request.currency <> v_tip.currency
    or v_request.status <> 'EXECUTING'
    or v_request.approved_at is null
    or v_request.approval_count <> v_request.required_approval_count
    or coalesce(v_request.action_payload ->> 'tipRefundReasonCode', '') not in
      ('DUPLICATE', 'MISTAKEN_AMOUNT', 'UNAUTHORISED', 'DISPUTE') then
    raise exception 'Tip refund requires an exact executing Money Desk approval';
  end if;

  select count(distinct lower(d.approver_email)) into v_approvers
    from public.money_desk_decisions d
    where d.request_id = v_request.id and d.decision = 'APPROVE'
      and d.approver_role in ('FINANCE', 'ADMIN')
      and lower(d.approver_email) <> lower(v_request.requester_email);
  if v_approvers < v_request.required_approval_count
    or not exists (
      select 1 from public.money_desk_execution_attempts e
      where e.request_id = v_request.id and e.status = 'PROCESSING'
    ) then
    raise exception 'Tip refund approvals or execution attempt are incomplete';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_tip_payout_ledger_receipt_rewrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.payout_ledger_transaction_id is not null
    and new.payout_ledger_transaction_id is distinct from
      old.payout_ledger_transaction_id then
    raise exception 'Recorded tip payout journal cannot be rewritten';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.prevent_unreviewed_blocked_tip_claim_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.status='BLOCKED_IDENTITY' and new.status<>'BLOCKED_IDENTITY' then
    raise exception 'Blocked tip payout needs reviewed reconciliation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_tip_money_operation(p_tip_id uuid, p_operation_kind text, p_request_key text, p_money_desk_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tip public.order_tips%rowtype;
  v_prior public.tip_money_operation_claims%rowtype;
  v_opposite public.tip_money_operation_claims%rowtype;
  v_request public.money_desk_requests%rowtype;
  v_mode text;
  v_claim public.tip_money_operation_claims%rowtype;
begin
  if p_operation_kind not in ('PAYOUT', 'REFUND') or nullif(trim(p_request_key), '') is null then
    raise exception 'Invalid tip operation kind or request key';
  end if;

  -- Row lock is held only through this RPC transaction, never through an HTTP call.
  select * into v_tip from public.order_tips where id = p_tip_id for update;
  if v_tip.id is null then raise exception 'Tip not found'; end if;

  select * into v_prior from public.tip_money_operation_claims
    where tip_id = p_tip_id and operation_kind = p_operation_kind;
  if v_prior.id is not null then
    if v_prior.request_key <> p_request_key
      or v_prior.money_desk_request_id is distinct from p_money_desk_request_id then
      raise exception 'Tip operation claim already belongs to a different request';
    end if;
    return jsonb_build_object('outcome', 'EXISTING', 'claim_id', v_prior.id,
      'status', v_prior.status, 'refund_funding_mode', v_prior.refund_funding_mode,
      'provider_operation_id', v_prior.provider_operation_id);
  end if;

  if p_operation_kind = 'PAYOUT' then
    if p_money_desk_request_id is not null then raise exception 'Payout claim cannot carry a refund approval'; end if;
    if exists (select 1 from public.tip_money_operation_claims where tip_id = p_tip_id and operation_kind = 'REFUND') then
      return jsonb_build_object('outcome', 'BLOCKED_BY_REFUND');
    end if;
    if v_tip.status <> 'PAYOUT_PENDING' or v_tip.payout_id is not null
      or exists (select 1 from public.payouts p where p.payout_purpose = 'TIP' and p.source_payment_id = v_tip.payment_id) then
      return jsonb_build_object('outcome', 'NOT_RELEASABLE', 'tip_status', v_tip.status);
    end if;
    insert into public.tip_money_operation_claims (tip_id, operation_kind, request_key, provider)
      values (p_tip_id, 'PAYOUT', p_request_key, v_tip.provider)
      returning * into v_claim;
    update public.order_tips set status = 'PROCESSING', updated_at = now() where id = p_tip_id;
    insert into public.order_tip_events (tip_id, event_type, actor_role, payload, correlation_id)
      values (p_tip_id, 'TIP_PAYOUT_RESERVED', 'SYSTEM', jsonb_build_object('claim_id', v_claim.id), v_tip.correlation_id);
    return jsonb_build_object('outcome', 'RESERVED', 'claim_id', v_claim.id, 'status', v_claim.status);
  end if;

  select * into v_request from public.money_desk_requests where id = p_money_desk_request_id;
  if v_request.id is null or v_request.action_type <> 'CUSTOMER_REFUND'
    or v_request.target_type <> 'ORDER_TIP' or v_request.target_id <> p_tip_id::text
    or v_request.order_id <> v_tip.order_id or v_request.status <> 'EXECUTING'
    or v_request.amount <> v_tip.amount or v_request.currency <> v_tip.currency then
    raise exception 'Tip refund claim requires an executing, matching Money Desk approval';
  end if;

  select * into v_opposite from public.tip_money_operation_claims
    where tip_id = p_tip_id and operation_kind = 'PAYOUT';
  if v_opposite.id is not null and v_opposite.status not in ('SUCCEEDED', 'FAILED_RECONCILED') then
    return jsonb_build_object('outcome', 'WAIT_PAYOUT', 'payout_claim_id', v_opposite.id,
      'payout_status', v_opposite.status);
  end if;
  if v_opposite.id is not null and v_opposite.status = 'SUCCEEDED' then
    v_mode := 'POST_PAYOUT';
  elsif v_opposite.id is not null and v_opposite.status = 'FAILED_RECONCILED' then
    -- A failed payout can only be refunded after its provider outcome is proven.
    v_mode := 'UNPAID_TIP';
  elsif v_tip.status = 'PAID_OUT' or v_tip.payout_id is not null
    or exists (select 1 from public.payouts p where p.payout_purpose = 'TIP' and p.source_payment_id = v_tip.payment_id) then
    return jsonb_build_object('outcome', 'WAIT_LEGACY_PAYOUT');
  elsif v_tip.status = 'PAYOUT_PENDING' then
    v_mode := 'UNPAID_TIP';
  else
    return jsonb_build_object('outcome', 'NOT_REFUNDABLE', 'tip_status', v_tip.status);
  end if;

  insert into public.tip_money_operation_claims
    (tip_id, operation_kind, request_key, money_desk_request_id, refund_funding_mode, provider)
    values (p_tip_id, 'REFUND', p_request_key, p_money_desk_request_id, v_mode, v_tip.provider)
    returning * into v_claim;
  if v_mode = 'UNPAID_TIP' then
    update public.order_tips set status = 'HELD', updated_at = now() where id = p_tip_id;
  end if;
  insert into public.order_tip_events (tip_id, event_type, actor_role, payload, correlation_id)
    values (p_tip_id, 'TIP_REFUND_RESERVED', 'SYSTEM',
      jsonb_build_object('claim_id', v_claim.id, 'funding_mode', v_mode, 'money_desk_request_id', p_money_desk_request_id),
      v_tip.correlation_id);
  return jsonb_build_object('outcome', 'RESERVED', 'claim_id', v_claim.id,
    'status', v_claim.status, 'refund_funding_mode', v_mode);
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_tip_money_operation_outcome(p_claim_id uuid, p_next_status text, p_provider text, p_provider_operation_id text, p_provider_response jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_claim public.tip_money_operation_claims%rowtype;
  v_late_success boolean := false;
  v_order_id text;
begin
  if p_next_status not in ('PROVIDER_UNKNOWN','PROVIDER_PENDING','SUCCEEDED','FAILED_RECONCILED')
    or nullif(btrim(p_provider),'') is null
    or p_provider_response is null or jsonb_typeof(p_provider_response)<>'object'
    or p_provider_response='{}'::jsonb then
    raise exception 'Tip operation outcome needs a provider and nonempty evidence';
  end if;
  if p_next_status='SUCCEEDED' and nullif(btrim(p_provider_operation_id),'') is null then
    raise exception 'A completed tip operation needs a provider reference';
  end if;
  if p_next_status='FAILED_RECONCILED'
    and p_provider_response->>'terminal_failure_confirmed' is distinct from 'true' then
    raise exception 'Only explicit terminal provider evidence can reconcile a TIP operation failure';
  end if;
  select * into v_claim from public.tip_money_operation_claims
    where id=p_claim_id for update;
  if v_claim.id is null then raise exception 'Tip operation claim not found'; end if;
  if v_claim.provider is not null and v_claim.provider::text<>p_provider then
    raise exception 'Tip operation provider cannot change';
  end if;
  if v_claim.provider_operation_id is not null
    and v_claim.provider_operation_id is distinct from p_provider_operation_id then
    raise exception 'Tip operation provider reference cannot change';
  end if;
  if v_claim.status='SUCCEEDED' then
    if p_next_status='SUCCEEDED'
      and v_claim.provider_operation_id=p_provider_operation_id then
      return jsonb_build_object('outcome','EXISTING','status',v_claim.status,'claim_id',v_claim.id);
    end if;
    raise exception 'Confirmed tip operation cannot be downgraded';
  end if;
  if v_claim.status='BLOCKED_IDENTITY' then
    raise exception 'Blocked tip operation requires reviewed reconciliation';
  end if;
  if v_claim.status='FAILED_RECONCILED' then
    if p_next_status='FAILED_RECONCILED' then
      return jsonb_build_object('outcome','EXISTING','status',v_claim.status,'claim_id',v_claim.id);
    end if;
    if p_next_status<>'SUCCEEDED'
      or p_provider_response->>'late_success_after_failure' is distinct from 'true'
      or v_claim.provider_operation_id is distinct from p_provider_operation_id then
      raise exception 'Reconciled TIP failure may only advance on exact provider late-success evidence';
    end if;
    v_late_success := true;
  end if;
  if v_claim.status='PROVIDER_PENDING' and p_next_status='PROVIDER_UNKNOWN' then
    raise exception 'Tip operation cannot regress from provider pending to unknown';
  end if;
  update public.tip_money_operation_claims set
    status=p_next_status,
    provider=p_provider::public.payment_provider,
    provider_operation_id=coalesce(provider_operation_id,nullif(btrim(p_provider_operation_id),'')),
    provider_response=p_provider_response,
    provider_checked_at=now(),
    terminal_at=case when p_next_status in ('SUCCEEDED','FAILED_RECONCILED') then now() else null end,
    updated_at=now()
    where id=p_claim_id;
  if v_late_success then
    select order_id into v_order_id from public.order_tips where id=v_claim.tip_id;
    insert into public.ops_issues (
      issue_type,severity,status,source,order_id,related_entity_type,
      related_entity_id,provider,title,description,recommended_action,
      dedupe_key,metadata
    ) values (
      'PAYOUT_LATE_SUCCESS','HIGH','OPEN','tip-money-operation',v_order_id,
      'ORDER_TIP',v_claim.tip_id::text,p_provider,
      'Tip transfer succeeded after a reconciled failure',
      'The provider later confirmed the exact tip operation after a terminal failure was recorded. The success was preserved; reconcile any refund or payout collision.',
      'Review the provider receipt, tip liability and any competing refund claim. Do not send a second transfer.',
      'tip-late-success:'||v_claim.id::text,
      jsonb_build_object('tip_id',v_claim.tip_id,'claim_id',v_claim.id,
        'operation_kind',v_claim.operation_kind,'provider_operation_id',p_provider_operation_id)
    ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now();
  end if;
  return jsonb_build_object('outcome',case when v_late_success then 'LATE_SUCCESS' else 'RECORDED' end,
    'status',p_next_status,'claim_id',p_claim_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_claimed_stripe_tip_payout_core(p_tip_id uuid, p_claim_id uuid, p_payout_id text, p_provider_transfer_id text, p_provider_response jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tip public.order_tips%rowtype;
  v_claim public.tip_money_operation_claims%rowtype;
  v_payout public.payouts%rowtype;
  v_payment public.order_payments%rowtype;
  v_ledger_id uuid;
  v_review_needed boolean;
begin
  if nullif(btrim(p_provider_transfer_id),'') is null
    or p_provider_response is null
    or jsonb_typeof(p_provider_response)<>'object' then
    raise exception 'Confirmed Stripe tip transfer evidence is required';
  end if;
  -- Match the tip/refund reservation lock order.
  select * into v_tip from public.order_tips where id=p_tip_id for update;
  select * into v_claim from public.tip_money_operation_claims
    where id=p_claim_id and tip_id=p_tip_id and operation_kind='PAYOUT' for update;
  select * into v_payout from public.payouts where id=p_payout_id for update;
  if v_tip.id is null or v_claim.id is null or v_payout.id is null
    or v_claim.status<>'SUCCEEDED' or v_claim.provider::text<>'STRIPE'
    or v_claim.provider_operation_id is distinct from p_provider_transfer_id
    or v_claim.payout_id is distinct from p_payout_id
    or v_payout.payout_purpose<>'TIP'
    or v_payout.provider::text<>'STRIPE'
    or v_payout.order_id is distinct from v_tip.order_id
    or v_payout.source_payment_id is distinct from v_tip.payment_id
    or not exists (select 1 from public.tailor_profiles tp
      where tp.id=v_payout.tailor_profile_id
        and tp.user_id=v_tip.tailor_id::text)
    or v_payout.amount is distinct from v_tip.amount
    or v_payout.currency is distinct from v_tip.currency then
    raise exception 'Claimed tip payout does not match its confirmed Stripe transfer';
  end if;
  if v_payout.provider_payout_id is not null
    and v_payout.provider_payout_id is distinct from p_provider_transfer_id then
    raise exception 'Tip payout has a different provider transfer';
  end if;
  if (v_tip.payout_id is not null and v_tip.payout_id is distinct from p_payout_id)
    or (v_tip.payout_provider_reference is not null
      and v_tip.payout_provider_reference is distinct from p_provider_transfer_id) then
    raise exception 'Tip already points to a different payout';
  end if;
  select * into v_payment from public.order_payments where id=v_tip.payment_id;
  if v_payment.id is null or v_payment.order_id is distinct from v_tip.order_id
    or v_payment.phase<>'TIP' or v_payment.provider::text<>'STRIPE'
    or v_payment.amount is distinct from v_tip.amount
    or v_payment.currency is distinct from v_tip.currency
    or v_payment.status not in ('SUCCEEDED','REFUNDED') then
    raise exception 'Tip source payment is not a confirmed captured charge';
  end if;

  v_review_needed := v_payment.status<>'SUCCEEDED'
    or v_tip.status not in ('PAYOUT_PENDING','PROCESSING','PAID_OUT');
  v_ledger_id := public.post_commercial_ledger_transaction(
    'tip-payout:'||v_tip.id::text,'ADJUSTMENT','TIP_PAYOUT',
    v_tip.order_id,v_tip.payment_id,'benefits-2026-08-01-v1',1,
    v_tip.correlation_id,p_provider_transfer_id,
    jsonb_build_array(
      jsonb_build_object('accountCode','TIP_LIABILITY','accountScope','order',
        'direction','DEBIT','amount',v_tip.amount,'currency',v_tip.currency),
      jsonb_build_object('accountCode','TAILOR_RELEASED','accountScope',v_tip.order_id,
        'direction','CREDIT','amount',v_tip.amount,'currency',v_tip.currency)),
    jsonb_build_object('tip_id',v_tip.id,'payout_id',p_payout_id),
    null,null,'SYSTEM',v_tip.currency,v_tip.amount,
    v_tip.currency,v_tip.amount,1,0
  );
  if v_claim.payout_ledger_transaction_id is not null
    and v_claim.payout_ledger_transaction_id is distinct from v_ledger_id then
    raise exception 'Tip already points to a different payout journal';
  end if;
  if v_claim.payout_ledger_transaction_id=v_ledger_id
    and v_tip.payout_id=p_payout_id
    and v_tip.payout_provider_reference=p_provider_transfer_id then
    return jsonb_build_object('outcome','EXISTING','tip_id',v_tip.id,
      'payout_id',p_payout_id,'ledger_id',v_ledger_id,
      'provider_transfer_id',p_provider_transfer_id,
      'review_needed',v_review_needed);
  end if;
  update public.tip_money_operation_claims
    set payout_ledger_transaction_id=v_ledger_id,updated_at=now()
    where id=p_claim_id and (payout_ledger_transaction_id is null
      or payout_ledger_transaction_id=v_ledger_id);
  if not found then raise exception 'Tip claim payout journal conflicts'; end if;
  update public.payouts set status='PROCESSING',
    provider_payout_id=p_provider_transfer_id,
    provider_transfer_status='AVAILABLE_IN_PROVIDER_BALANCE',
    bank_settlement_status='PENDING',
    provider_response=p_provider_response
    where id=p_payout_id;
  update public.order_tips set
    status=case when status in ('PAYOUT_PENDING','PROCESSING','PAID_OUT')
      then 'PAID_OUT' else status end,
    payout_id=p_payout_id,
    payout_provider_reference=p_provider_transfer_id,
    paid_out_at=coalesce(paid_out_at,now()),
    failure_reason=null,updated_at=now()
    where id=v_tip.id;
  if not exists (select 1 from public.order_tip_events
    where tip_id=v_tip.id and event_type='TIP_PAID_OUT'
      and payload->>'provider_reference'=p_provider_transfer_id) then
    insert into public.order_tip_events (
      tip_id,event_type,actor_role,payload,correlation_id
    ) values (
      v_tip.id,'TIP_PAID_OUT','SYSTEM',
      jsonb_build_object('payout_id',p_payout_id,'provider','STRIPE',
        'provider_reference',p_provider_transfer_id,'review_needed',v_review_needed),
      v_tip.correlation_id
    );
  end if;
  if v_review_needed then
    insert into public.ops_issues (
      issue_type,severity,status,source,order_id,related_entity_type,
      related_entity_id,provider,title,description,recommended_action,
      dedupe_key,metadata
    ) values (
      'PAYOUT_LATE_SUCCESS','HIGH','OPEN','claimed-tip-payout',
      v_tip.order_id,'ORDER_TIP',v_tip.id::text,'STRIPE',
      'Tip transfer confirmed during a refund or hold',
      'Stripe confirmed the tailor transfer while the tip payment or tip state changed. The real payout was recorded without overwriting the refund or hold.',
      'Reconcile the captured charge, reviewed refund, tailor receipt, and Money Desk case.',
      'tip-payout-review:'||v_tip.id::text,
      jsonb_build_object('tip_id',v_tip.id,'payout_id',p_payout_id,
        'claim_id',p_claim_id,'provider_transfer_id',p_provider_transfer_id,
        'payment_status',v_payment.status,'prior_tip_status',v_tip.status)
    ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now();
  end if;
  return jsonb_build_object('outcome','COMPLETED','tip_id',v_tip.id,
    'payout_id',p_payout_id,'ledger_id',v_ledger_id,
    'provider_transfer_id',p_provider_transfer_id,
    'review_needed',v_review_needed);
end $function$;

CREATE OR REPLACE FUNCTION public.finalize_claimed_stripe_tip_payout(p_tip_id uuid, p_claim_id uuid, p_payout_id text, p_provider_transfer_id text, p_provider_response jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_receipt jsonb;
  v_refund public.tip_money_operation_claims%rowtype;
  v_tip public.order_tips%rowtype;
  v_payment public.order_payments%rowtype;
begin
  v_receipt := public.finalize_claimed_stripe_tip_payout_core(
    p_tip_id,p_claim_id,p_payout_id,p_provider_transfer_id,p_provider_response);
  select * into v_refund from public.tip_money_operation_claims
    where tip_id=p_tip_id and operation_kind='REFUND' and status='SUCCEEDED';
  if v_refund.id is null or v_refund.refund_funding_mode<>'POST_PAYOUT'
    or nullif(btrim(v_refund.provider_operation_id),'') is null then
    return v_receipt;
  end if;
  select * into v_tip from public.order_tips where id=p_tip_id;
  select * into v_payment from public.order_payments where id=v_tip.payment_id;
  if v_payment.status<>'REFUNDED' or v_payment.refunded_amount<>v_tip.amount
    or not exists (select 1 from public.commercial_ledger_transactions l
      where l.payment_id=v_tip.payment_id and l.order_id=v_tip.order_id
        and l.transaction_kind='REFUND' and l.purpose='TIP'
        and l.provider_reference=v_refund.provider_operation_id) then
    return v_receipt;
  end if;
  begin
    perform public.finalize_claimed_tip_refund(
      p_tip_id,v_refund.id,v_refund.provider_operation_id);
    return v_receipt || jsonb_build_object('waiting_refund_finalized',true);
  exception when others then
    -- A real confirmed transfer must not disappear because refund bookkeeping
    -- needs repair. Preserve the payout receipt and queue the exact claim.
    insert into public.ops_issues (
      issue_type,severity,status,source,order_id,related_entity_type,
      related_entity_id,provider,title,description,recommended_action,
      dedupe_key,metadata
    ) values (
      'REFUND_FAILED','HIGH','OPEN','claimed-tip-payout-refund-repair',
      v_tip.order_id,'ORDER_TIP',p_tip_id::text,'STRIPE',
      'Confirmed tip refund needs final reconciliation',
      'The payout receipt was recorded, but a provider-confirmed full tip refund could not be finalized.',
      'Review the exact payout and refund claims and retry finalization without creating another provider refund.',
      'tip-refund-repair:'||p_tip_id::text,
      jsonb_build_object('tip_id',p_tip_id,'refund_claim_id',v_refund.id,
        'payout_claim_id',p_claim_id,'provider_refund_id',v_refund.provider_operation_id,
        'error',sqlerrm)
    ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now();
    return v_receipt || jsonb_build_object('waiting_refund_finalized',false);
  end;
end $function$;

CREATE OR REPLACE FUNCTION public.finalize_claimed_tip_refund(p_tip_id uuid, p_claim_id uuid, p_provider_refund_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tip public.order_tips%rowtype;
  v_claim public.tip_money_operation_claims%rowtype;
  v_payment public.order_payments%rowtype;
begin
  if nullif(btrim(p_provider_refund_id),'') is null then
    raise exception 'Provider refund reference is required';
  end if;
  select * into v_tip from public.order_tips where id=p_tip_id for update;
  if v_tip.id is null or v_tip.payment_id is null then
    raise exception 'Tip payment is missing';
  end if;
  select * into v_claim from public.tip_money_operation_claims
    where id=p_claim_id and tip_id=p_tip_id and operation_kind='REFUND' for update;
  if v_claim.id is null or v_claim.status<>'SUCCEEDED'
    or v_claim.provider_operation_id is distinct from p_provider_refund_id then
    raise exception 'Tip refund claim lacks matching terminal provider evidence';
  end if;
  select * into v_payment from public.order_payments where id=v_tip.payment_id;
  if v_payment.id is null or v_payment.order_id<>v_tip.order_id
    or v_payment.phase<>'TIP' or v_payment.status<>'REFUNDED'
    or v_payment.amount<>v_tip.amount or v_payment.refunded_amount<>v_tip.amount
    or v_payment.currency<>v_tip.currency then
    raise exception 'Tip payment does not have an exact full refund';
  end if;
  if not exists (select 1 from public.commercial_ledger_transactions l
    where l.payment_id=v_payment.id and l.order_id=v_tip.order_id
      and l.transaction_kind='REFUND' and l.purpose='TIP'
      and l.provider_reference=p_provider_refund_id) then
    raise exception 'Tip refund journal is missing';
  end if;
  if v_claim.refund_funding_mode='POST_PAYOUT' and not exists (
    select 1 from public.tip_money_operation_claims payout_claim
    join public.payouts p on p.id=payout_claim.payout_id
    join public.commercial_ledger_transactions l
      on l.id=payout_claim.payout_ledger_transaction_id
    where payout_claim.tip_id=v_tip.id and payout_claim.operation_kind='PAYOUT'
      and payout_claim.status='SUCCEEDED'
      and payout_claim.provider_operation_id=v_tip.payout_provider_reference
      and p.id=v_tip.payout_id and p.order_id=v_tip.order_id
      and p.source_payment_id=v_tip.payment_id and p.payout_purpose='TIP'
      and p.amount=v_tip.amount and p.currency=v_tip.currency
      and p.provider_payout_id=v_tip.payout_provider_reference
      and l.payment_id=v_tip.payment_id and l.order_id=v_tip.order_id
      and l.purpose='TIP_PAYOUT'
      and l.provider_reference=v_tip.payout_provider_reference
  ) then
    return jsonb_build_object('outcome','PENDING_PAYOUT','tip_id',v_tip.id);
  end if;
  if v_tip.status='REFUNDED' then
    return jsonb_build_object('outcome','EXISTING','tip_id',v_tip.id);
  end if;
  update public.order_tips set status='REFUNDED',failure_reason=null,updated_at=now()
    where id=v_tip.id;
  insert into public.order_tip_events (tip_id,event_type,actor_role,payload,correlation_id)
    values (v_tip.id,'TIP_REFUNDED','SYSTEM',
      jsonb_build_object('paymentId',v_payment.id,'refundId',p_provider_refund_id,
        'claimId',v_claim.id,'reviewed',true,'fundingMode',v_claim.refund_funding_mode),
      v_tip.correlation_id);
  return jsonb_build_object('outcome','FINALIZED','tip_id',v_tip.id);
end $function$;

create or replace trigger guard_tip_refund_real_approval_before_insert
  before insert on public.tip_money_operation_claims
  for each row execute function public.guard_tip_refund_real_approval();
create or replace trigger tip_money_blocked_identity_guard
  before update of status on public.tip_money_operation_claims
  for each row execute function public.prevent_unreviewed_blocked_tip_claim_transition();
create or replace trigger tip_payout_ledger_receipt_immutable
  before update of payout_ledger_transaction_id on public.tip_money_operation_claims
  for each row execute function public.prevent_tip_payout_ledger_receipt_rewrite();

revoke execute on function public.guard_tip_refund_real_approval() from public,anon,authenticated;
grant execute on function public.guard_tip_refund_real_approval() to service_role;

revoke execute on function public.prevent_tip_payout_ledger_receipt_rewrite() from public,anon,authenticated;
grant execute on function public.prevent_tip_payout_ledger_receipt_rewrite() to service_role;

revoke execute on function public.prevent_unreviewed_blocked_tip_claim_transition() from public,anon,authenticated;
grant execute on function public.prevent_unreviewed_blocked_tip_claim_transition() to service_role;

revoke execute on function public.reserve_tip_money_operation(p_tip_id uuid, p_operation_kind text, p_request_key text, p_money_desk_request_id uuid) from public,anon,authenticated;
grant execute on function public.reserve_tip_money_operation(p_tip_id uuid, p_operation_kind text, p_request_key text, p_money_desk_request_id uuid) to service_role;

revoke execute on function public.record_tip_money_operation_outcome(p_claim_id uuid, p_next_status text, p_provider text, p_provider_operation_id text, p_provider_response jsonb) from public,anon,authenticated;
grant execute on function public.record_tip_money_operation_outcome(p_claim_id uuid, p_next_status text, p_provider text, p_provider_operation_id text, p_provider_response jsonb) to service_role;

revoke execute on function public.finalize_claimed_stripe_tip_payout_core(p_tip_id uuid, p_claim_id uuid, p_payout_id text, p_provider_transfer_id text, p_provider_response jsonb) from public,anon,authenticated;
grant execute on function public.finalize_claimed_stripe_tip_payout_core(p_tip_id uuid, p_claim_id uuid, p_payout_id text, p_provider_transfer_id text, p_provider_response jsonb) to service_role;

revoke execute on function public.finalize_claimed_stripe_tip_payout(p_tip_id uuid, p_claim_id uuid, p_payout_id text, p_provider_transfer_id text, p_provider_response jsonb) from public,anon,authenticated;
grant execute on function public.finalize_claimed_stripe_tip_payout(p_tip_id uuid, p_claim_id uuid, p_payout_id text, p_provider_transfer_id text, p_provider_response jsonb) to service_role;

revoke execute on function public.finalize_claimed_tip_refund(p_tip_id uuid, p_claim_id uuid, p_provider_refund_id text) from public,anon,authenticated;
grant execute on function public.finalize_claimed_tip_refund(p_tip_id uuid, p_claim_id uuid, p_provider_refund_id text) to service_role;
