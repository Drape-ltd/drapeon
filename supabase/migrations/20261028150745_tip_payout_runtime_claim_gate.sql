-- Runtime binding and a one-writer start gate for the TIP payout claim.
-- A crash after the start commit is uncertain; recovery must look up the
-- provider operation and must never start a second transfer.

create function public.bind_tip_payout_claim(
  p_claim_id uuid,
  p_payout_id text,
  p_provider text,
  p_provider_destination_id text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_tip public.order_tips%rowtype;
  v_claim public.tip_money_operation_claims%rowtype;
  v_payout public.payouts%rowtype;
begin
  if nullif(btrim(p_payout_id),'') is null
    or nullif(btrim(p_provider),'') is null
    or nullif(btrim(p_provider_destination_id),'') is null then
    raise exception 'TIP payout binding requires a complete provider identity';
  end if;

  select t.* into v_tip
    from public.order_tips t
    join public.tip_money_operation_claims c on c.tip_id=t.id
    where c.id=p_claim_id for update of t;
  select * into v_claim from public.tip_money_operation_claims
    where id=p_claim_id for update;
  select * into v_payout from public.payouts
    where id_text=p_payout_id for update;

  if v_tip.id is null or v_claim.id is null or v_payout.id is null
    or v_claim.operation_kind<>'PAYOUT'
    or v_claim.status not in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING','SUCCEEDED')
    or v_tip.payment_id is null
    or v_tip.provider::text is distinct from p_provider
    or v_claim.provider::text is distinct from p_provider
    or v_payout.payout_purpose<>'TIP'
    or v_payout.order_id is distinct from v_tip.order_id
    or v_payout.source_payment_id is distinct from v_tip.payment_id
    or v_payout.amount is distinct from v_tip.amount
    or v_payout.currency is distinct from v_tip.currency
    or v_payout.provider::text is distinct from p_provider
    or v_payout.provider_destination_id is distinct from p_provider_destination_id
    or not exists (select 1 from public.tailor_profiles tp
      where tp.id=v_payout.tailor_profile_id
        and tp.user_id::text=v_tip.tailor_id::text) then
    raise exception 'TIP payout row does not match its reserved claim';
  end if;
  if v_claim.payout_id is not null and v_claim.payout_id is distinct from p_payout_id then
    raise exception 'TIP payout claim is already bound to another payout row';
  end if;
  update public.tip_money_operation_claims set payout_id=p_payout_id,updated_at=now()
    where id=v_claim.id and (payout_id is null or payout_id=p_payout_id);
  if not found then raise exception 'TIP payout claim binding changed concurrently'; end if;
  return jsonb_build_object('outcome',case when v_claim.payout_id=p_payout_id then 'EXISTING' else 'BOUND' end,
    'claim_id',v_claim.id,'payout_id',p_payout_id);
end;
$$;

revoke all on function public.bind_tip_payout_claim(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.bind_tip_payout_claim(uuid,text,text,text)
  to service_role;

create function public.start_tip_money_operation_provider_call(p_claim_id uuid)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_claim public.tip_money_operation_claims%rowtype;
begin
  select * into v_claim from public.tip_money_operation_claims
    where id=p_claim_id for update;
  if v_claim.id is null then
    raise exception 'A reserved TIP money operation is required before provider execution';
  end if;
  if v_claim.operation_kind='PAYOUT' and v_claim.payout_id is null then
    raise exception 'A bound TIP payout claim is required before provider execution';
  end if;
  if v_claim.operation_kind='REFUND' and (
      v_claim.money_desk_request_id is null or v_claim.refund_funding_mode is null) then
    raise exception 'A reviewed TIP refund claim is required before provider execution';
  end if;
  if v_claim.status='RESERVED' then
    update public.tip_money_operation_claims set
      status='PROVIDER_UNKNOWN',
      provider_response=jsonb_build_object('provider_call_started',true),
      provider_checked_at=now(),updated_at=now()
      where id=v_claim.id and status='RESERVED';
    if not found then raise exception 'TIP payout start gate changed concurrently'; end if;
    return jsonb_build_object('outcome','SEND','claim_id',v_claim.id,
      'provider',v_claim.provider,'provider_operation_id',v_claim.provider_operation_id,
      'payout_id',v_claim.payout_id);
  end if;
  if v_claim.status in ('PROVIDER_UNKNOWN','PROVIDER_PENDING','SUCCEEDED',
      'FAILED_RECONCILED','BLOCKED_IDENTITY') then
    return jsonb_build_object('outcome','RECONCILE','claim_id',v_claim.id,
      'status',v_claim.status,'provider',v_claim.provider,
      'provider_operation_id',v_claim.provider_operation_id,
      'payout_id',v_claim.payout_id);
  end if;
  raise exception 'TIP payout claim cannot enter provider execution from %',v_claim.status;
end;
$$;

revoke all on function public.start_tip_money_operation_provider_call(uuid)
  from public,anon,authenticated;
grant execute on function public.start_tip_money_operation_provider_call(uuid)
  to service_role;

-- TIP provider outcomes stay forward-only, but a provider-confirmed late
-- success after a reconciled failure is still real money and must be applied.
create or replace function public.record_tip_money_operation_outcome(
  p_claim_id uuid,
  p_next_status text,
  p_provider text,
  p_provider_operation_id text,
  p_provider_response jsonb
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
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
$$;

revoke all on function public.record_tip_money_operation_outcome(uuid,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.record_tip_money_operation_outcome(uuid,text,text,text,jsonb)
  to service_role;
