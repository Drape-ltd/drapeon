-- Forward-only closure for the Phase 1 claim APIs required by the Phase 3
-- payment Edge code. Production did not receive the original 2026-10-22 claim
-- migrations; this installs the final Dev contracts without replaying history.
-- No provider calls, payout rows, or refund rows are created here.

do $$
begin
  if to_regclass('public.payout_claims') is null
    or to_regclass('public.payout_attempts') is null
    or to_regclass('public.order_payment_refund_claims') is null then
    raise exception 'Claim foundation tables must be restored before claim RPCs';
  end if;
end;
$$;

create or replace function public.reserve_payout_claim(
  p_business_key text,
  p_source_kind text,
  p_source_id text,
  p_order_id text,
  p_tailor_profile_id text,
  p_provider text,
  p_provider_destination_id text,
  p_currency public.currency,
  p_amount integer,
  p_route_version text,
  p_earning_policy_version text,
  p_tailor_terms_version text,
  p_provider_idempotency_key text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_inserted uuid;
  v_claim public.payout_claims%rowtype;
begin
  if nullif(btrim(p_business_key),'') is null
    or nullif(btrim(p_source_id),'') is null
    or nullif(btrim(p_provider_idempotency_key),'') is null then
    raise exception 'Payout claim needs stable business and provider keys';
  end if;

  select * into v_claim from public.payout_claims
    where business_key=p_business_key for update;
  if not found then
    insert into public.payout_claims (
      business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
      provider_destination_id,currency,amount,route_version,
      earning_policy_version,tailor_terms_version,provider_idempotency_key
    ) values (
      p_business_key,p_source_kind,p_source_id,p_order_id,p_tailor_profile_id,
      p_provider,p_provider_destination_id,p_currency,p_amount,p_route_version,
      p_earning_policy_version,p_tailor_terms_version,p_provider_idempotency_key
    ) on conflict do nothing returning id into v_inserted;
    select * into v_claim from public.payout_claims
      where business_key=p_business_key for update;
  end if;
  if v_claim.id is null then
    raise exception 'Payout claim key conflicts with an unrelated earning or provider key';
  end if;
  if row(v_claim.source_kind,v_claim.source_id,v_claim.order_id,
         v_claim.tailor_profile_id,v_claim.provider,
         v_claim.provider_destination_id,v_claim.currency,v_claim.amount,
         v_claim.route_version,v_claim.earning_policy_version,
         v_claim.tailor_terms_version,v_claim.provider_idempotency_key)
     is distinct from
     row(p_source_kind,p_source_id,p_order_id,p_tailor_profile_id,
         p_provider,p_provider_destination_id,p_currency,p_amount,
         p_route_version,p_earning_policy_version,p_tailor_terms_version,
         p_provider_idempotency_key) then
    raise exception 'Payout claim identity conflicts with accepted earning';
  end if;
  return jsonb_build_object(
    'outcome',case when v_inserted is null then 'EXISTING' else 'RESERVED' end,
    'claim_id',v_claim.id,'status',v_claim.status,
    'provider_idempotency_key',v_claim.provider_idempotency_key,
    'provider_transfer_id',v_claim.provider_transfer_id,
    'payout_id',v_claim.payout_id
  );
end;
$$;

revoke all on function public.reserve_payout_claim(
  text,text,text,text,text,text,text,public.currency,integer,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.reserve_payout_claim(
  text,text,text,text,text,text,text,public.currency,integer,text,text,text,text
) to service_role;

create or replace function public.block_payout_claim_identity_conflict(
  p_attempt_id uuid, p_evidence jsonb
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_claim public.payout_claims%rowtype;
  v_attempt public.payout_attempts%rowtype;
  v_claim_id uuid;
begin
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object'
    or p_evidence->>'identity_conflict' is distinct from 'true' then
    raise exception 'Identity conflict requires explicit provider evidence';
  end if;
  select claim_id into v_claim_id from public.payout_attempts where id=p_attempt_id;
  if v_claim_id is null then raise exception 'Payout attempt not found'; end if;
  select * into v_claim from public.payout_claims where id=v_claim_id for update;
  select * into v_attempt from public.payout_attempts where id=p_attempt_id for update;
  if v_attempt.claim_id <> v_claim.id then raise exception 'Payout attempt claim changed'; end if;
  if v_claim.status in ('TRANSFERRED','WITHDRAWN') or v_attempt.status='SUCCEEDED' then
    raise exception 'Confirmed payout requires a separate late-conflict review';
  end if;
  if v_claim.status not in ('PROVIDER_UNKNOWN','PROVIDER_PENDING','BLOCKED') then
    raise exception 'Identity conflict cannot block an unattempted payout';
  end if;
  update public.payout_attempts set status='PROVIDER_UNKNOWN',
    provider_evidence=p_evidence,error_class='PROVIDER_IDENTITY_CONFLICT'
    where id=p_attempt_id;
  update public.payout_claims set status='BLOCKED',transfer_status='UNKNOWN',
    last_provider_checked_at=now() where id=v_claim.id;
  insert into public.ops_issues (
    issue_type,severity,status,source,order_id,related_entity_type,related_entity_id,
    provider,title,description,recommended_action,dedupe_key,metadata
  ) values (
    'PAYOUT_FAILED','CRITICAL','OPEN','claimed-payout-execution',v_claim.order_id,
    'PAYOUT_CLAIM',v_claim.id::text,v_claim.provider,
    'Provider transfer conflicts with the payout claim',
    'Provider transfer evidence does not match this immutable earning claim.',
    'Reconcile the provider transfer, amount, currency and destination before any further operation.',
    'payout-identity-conflict:'||v_claim.id::text,
    jsonb_build_object('claim_id',v_claim.id,'attempt_id',p_attempt_id)
  ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now();
  return jsonb_build_object('outcome','BLOCKED','claim_id',v_claim.id);
end;
$$;

revoke all on function public.block_payout_claim_identity_conflict(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.block_payout_claim_identity_conflict(uuid,jsonb)
  to service_role;

create or replace function public.block_confirmed_payout_identity_conflict(
  p_claim_id uuid, p_evidence jsonb
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_claim public.payout_claims%rowtype;
  v_case_id uuid;
  v_dedupe_key text;
  v_environment text;
  v_prior_status text;
  v_receipt_consistent boolean;
  v_prior_case_status text;
begin
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object'
    or p_evidence->>'identity_conflict' is distinct from 'true' then
    raise exception 'Confirmed payout conflict requires explicit identity evidence';
  end if;
  select * into v_claim from public.payout_claims where id=p_claim_id for update;
  if v_claim.id is null then raise exception 'Payout claim not found'; end if;
  v_dedupe_key := 'payout-late-provider-conflict:'||v_claim.id::text;
  select id,status into v_case_id,v_prior_case_status from public.ops_issues
    where dedupe_key=v_dedupe_key for update;
  if v_claim.status='BLOCKED' then
    if v_case_id is null then
      raise exception 'Blocked payout claim has no confirmed-conflict case';
    end if;
    return jsonb_build_object('outcome','EXISTING','claim_id',v_claim.id,
      'issue_id',v_case_id);
  end if;
  if v_claim.status not in ('TRANSFERRED','WITHDRAWN')
    or nullif(btrim(v_claim.provider_transfer_id),'') is null then
    raise exception 'Only a provider-confirmed payout can enter late identity review';
  end if;

  select exists (select 1 from public.payout_attempts a
    where a.claim_id=v_claim.id and a.status='SUCCEEDED'
      and a.provider_operation_id=v_claim.provider_transfer_id)
    into v_receipt_consistent;
  v_prior_status := v_claim.status;
  v_environment := public.current_ops_environment();
  if v_environment not in ('DEVELOPMENT','PRODUCTION') then
    raise exception 'Ops environment is not configured for confirmed payout review';
  end if;
  update public.payout_claims set status='BLOCKED',transfer_status='UNKNOWN',
    last_provider_checked_at=now() where id=v_claim.id;

  if v_case_id is null then
    insert into public.ops_issues (
      issue_type,severity,status,canonical_status,source,order_id,
      related_entity_type,related_entity_id,provider,title,description,
      recommended_action,dedupe_key,metadata,queue_key,owning_team,
      priority,sensitivity,environment,provenance
    ) values (
      'PAYOUT_FAILED','CRITICAL','OPEN','NEW','claimed-payout-execution',
      v_claim.order_id,'PAYOUT_CLAIM',v_claim.id::text,v_claim.provider,
      'Confirmed payout changed before ledger completion',
      'Provider transfer evidence changed after confirmation; local payout completion was held.',
      'Reconcile the exact provider transfer, stored attempt receipt and bank-withdrawal state before completing or replacing this earning.',
      v_dedupe_key,
      jsonb_build_object('claim_id',v_claim.id,
        'provider_transfer_id',v_claim.provider_transfer_id,
        'prior_claim_status',v_prior_status,
        'successful_attempt_matches_transfer',v_receipt_consistent),
      'money-desk','finance','P0','SENSITIVE',v_environment,
      case when v_environment='DEVELOPMENT' then 'QA' else 'REAL' end
    ) returning id into v_case_id;
    insert into public.ops_audit_logs (
      issue_id,action_taken,performed_role,reason,before_state,after_state
    ) values (
      v_case_id,'ISSUE_CREATED','SYSTEM',
      'Confirmed payout identity recheck contradicted the frozen transfer',null,
      jsonb_build_object('status','OPEN','canonical_status','NEW',
        'claim_id',v_claim.id,'prior_claim_status',v_prior_status,
        'claim_status','BLOCKED',
        'successful_attempt_matches_transfer',v_receipt_consistent)
    );
  else
    update public.ops_issues set status='OPEN',canonical_status='NEW',
      queue_key='money-desk',owning_team='finance',priority='P0',
      environment=v_environment,
      provenance=case when v_environment='DEVELOPMENT' then 'QA' else 'REAL' end,
      last_seen_at=now(),resolved_at=null where id=v_case_id;
    insert into public.ops_audit_logs (
      issue_id,action_taken,performed_role,reason,before_state,after_state
    ) values (
      v_case_id,
      case when v_prior_case_status='OPEN' then 'ISSUE_UPDATED' else 'ISSUE_REOPENED' end,
      'SYSTEM',
      'Confirmed payout claim was durably blocked after provider identity conflict',
      jsonb_build_object('claim_status',v_prior_status,'case_status',v_prior_case_status),
      jsonb_build_object('claim_status','BLOCKED','canonical_status','NEW',
        'successful_attempt_matches_transfer',v_receipt_consistent)
    );
  end if;
  return jsonb_build_object('outcome','BLOCKED','claim_id',v_claim.id,
    'issue_id',v_case_id);
end;
$$;

revoke all on function public.block_confirmed_payout_identity_conflict(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.block_confirmed_payout_identity_conflict(uuid,jsonb)
  to service_role;

create or replace function public.reserve_order_payment_refund_claim(
  p_payment_id uuid,
  p_order_id text,
  p_phase public.order_payment_phase,
  p_provider public.payment_provider,
  p_provider_payment_id text,
  p_operation_key text,
  p_refund_amount integer
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_payment public.order_payments%rowtype;
  v_claim public.order_payment_refund_claims%rowtype;
  v_refunded integer;
begin
  if p_payment_id is null or p_order_id is null or p_phase is null
    or p_provider is null or nullif(btrim(p_provider_payment_id),'') is null
    or nullif(btrim(p_operation_key),'') is null or coalesce(p_refund_amount,0)<=0 then
    return jsonb_build_object('outcome','INVALID_REQUEST');
  end if;

  -- Match the payout reservation lock order: order first, payment second.
  perform 1 from public.orders where id=p_order_id for update;
  if not found then return jsonb_build_object('outcome','NOT_FOUND'); end if;
  select * into v_payment from public.order_payments
    where id=p_payment_id for update;
  if not found then return jsonb_build_object('outcome','NOT_FOUND'); end if;
  if v_payment.order_id::text is distinct from p_order_id
    or v_payment.phase is distinct from p_phase
    or v_payment.provider is distinct from p_provider
    or v_payment.provider_payment_id is distinct from p_provider_payment_id then
    return jsonb_build_object('outcome','IDENTITY_CONFLICT');
  end if;

  select * into v_claim from public.order_payment_refund_claims
    where operation_key=p_operation_key;
  if found then
    if v_claim.payment_id<>p_payment_id or v_claim.order_id<>p_order_id
      or v_claim.phase<>p_phase or v_claim.provider<>p_provider
      or v_claim.provider_payment_id<>p_provider_payment_id
      or v_claim.refund_amount<>p_refund_amount then
      return jsonb_build_object('outcome','IDENTITY_CONFLICT');
    end if;
    return jsonb_build_object('outcome','EXISTING','claim_id',v_claim.id,
      'status',v_claim.status,'refunded_before',v_claim.refunded_before);
  end if;

  v_refunded:=coalesce(v_payment.refunded_amount,0);
  if v_payment.status not in ('SUCCEEDED','PARTIAL_REFUND')
    or v_payment.amount<=0 or v_refunded<0
    or v_refunded+p_refund_amount>v_payment.amount then
    return jsonb_build_object('outcome','NOT_REFUNDABLE');
  end if;
  select * into v_claim from public.order_payment_refund_claims
    where payment_id=p_payment_id and refunded_before=v_refunded;
  if found then
    return jsonb_build_object('outcome','POSITION_CLAIMED',
      'claim_id',v_claim.id,'status',v_claim.status);
  end if;
  insert into public.order_payment_refund_claims (
    payment_id,order_id,phase,provider,currency,charged_amount,
    refunded_before,refund_amount,provider_payment_id,operation_key
  ) values (
    v_payment.id,v_payment.order_id::text,v_payment.phase,v_payment.provider,
    v_payment.currency,v_payment.amount,v_refunded,p_refund_amount,
    v_payment.provider_payment_id,p_operation_key
  ) returning * into v_claim;
  return jsonb_build_object('outcome','RESERVED','claim_id',v_claim.id,
    'status',v_claim.status,'refunded_before',v_claim.refunded_before);
end;
$$;

revoke all on function public.reserve_order_payment_refund_claim(
  uuid,text,public.order_payment_phase,public.payment_provider,text,text,integer
) from public, anon, authenticated;
grant execute on function public.reserve_order_payment_refund_claim(
  uuid,text,public.order_payment_phase,public.payment_provider,text,text,integer
) to service_role;

comment on function public.reserve_order_payment_refund_claim(
  uuid,text,public.order_payment_phase,public.payment_provider,text,text,integer
) is 'Forward repair: reserves an exact refund position under the same order-first lock as payout claims; provider I/O occurs after commit.';
