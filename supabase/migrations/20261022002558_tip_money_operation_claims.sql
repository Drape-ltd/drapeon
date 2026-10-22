-- A tip refund and tip payout must reserve the same tip row before either calls a provider.
-- This migration is additive. Existing provider operations remain untouched until a
-- separately reviewed backfill and Edge rollout adopt these claims.
create table public.tip_money_operation_claims (
  id uuid primary key default gen_random_uuid(),
  tip_id uuid not null references public.order_tips(id) on delete restrict,
  operation_kind text not null check (operation_kind in ('PAYOUT', 'REFUND')),
  request_key text not null unique,
  status text not null default 'RESERVED' check (status in (
    'RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED_RECONCILED'
  )),
  refund_funding_mode text check (refund_funding_mode in ('UNPAID_TIP', 'POST_PAYOUT')),
  money_desk_request_id uuid references public.money_desk_requests(id) on delete restrict,
  provider payment_provider,
  provider_operation_id text,
  payout_id text references public.payouts(id_text) on delete restrict,
  provider_response jsonb not null default '{}'::jsonb,
  provider_checked_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tip_id, operation_kind),
  check (
    (operation_kind = 'PAYOUT' and money_desk_request_id is null and refund_funding_mode is null)
    or (operation_kind = 'REFUND' and money_desk_request_id is not null and refund_funding_mode is not null)
  )
);

create index tip_money_operation_claims_status_idx
  on public.tip_money_operation_claims(status, created_at);
create index tip_money_operation_claims_money_desk_idx
  on public.tip_money_operation_claims(money_desk_request_id)
  where money_desk_request_id is not null;
create index tip_money_operation_claims_payout_idx
  on public.tip_money_operation_claims(payout_id)
  where payout_id is not null;

alter table public.tip_money_operation_claims enable row level security;
revoke all on public.tip_money_operation_claims from public, anon, authenticated;
grant select, insert, update on public.tip_money_operation_claims to service_role;

create function public.reserve_tip_money_operation(
  p_tip_id uuid,
  p_operation_kind text,
  p_request_key text,
  p_money_desk_request_id uuid default null
)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
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
$$;

revoke execute on function public.reserve_tip_money_operation(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.reserve_tip_money_operation(uuid, text, text, uuid) to service_role;
