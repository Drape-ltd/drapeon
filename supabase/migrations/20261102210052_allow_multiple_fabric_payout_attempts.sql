-- A terminal fabric attempt keeps its immutable payout receipt. A later queue
-- retry receives a new payout row and therefore never needs FAILED -> PROCESSING.
drop index if exists public.payouts_fabric_candidate_idx;
create unique index payouts_fabric_candidate_idx
  on public.payouts(fabric_candidate_id)
  where fabric_candidate_id is not null
    and status not in ('FAILED', 'CANCELED');

-- A Stripe request that returned a provider-coded 4xx can be closed only after
-- a later metadata lookup proves no transfer exists for the same operation.
create or replace function public.reconcile_definite_payout_rejection(
  p_claim_id uuid,
  p_attempt_id uuid,
  p_reconciliation_evidence jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim public.payout_claims%rowtype;
  v_attempt public.payout_attempts%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_prior public.payout_attempts%rowtype;
  v_issue_id uuid;
begin
  if p_reconciliation_evidence is null
    or jsonb_typeof(p_reconciliation_evidence) <> 'object'
    or p_reconciliation_evidence->>'provider' is distinct from 'STRIPE'
    or p_reconciliation_evidence->>'reason' is distinct from 'no_transfer_found_for_operation'
  then
    return jsonb_build_object('outcome','NOT_DEFINITE');
  end if;

  select * into v_claim from public.payout_claims
    where id=p_claim_id for update;
  select * into v_attempt from public.payout_attempts
    where id=p_attempt_id and claim_id=p_claim_id for update;
  if v_claim.id is null or v_attempt.id is null
    or v_claim.status <> 'PROVIDER_UNKNOWN'
    or v_claim.provider_transfer_id is not null
    or v_attempt.status <> 'PREPARED'
    or v_attempt.claim_operation_id is null
  then
    return jsonb_build_object('outcome','NOT_DEFINITE');
  end if;
  select * into v_operation from public.payout_provider_operations
    where id=v_attempt.claim_operation_id and claim_id=p_claim_id for update;
  if v_operation.id is null or v_operation.provider <> 'STRIPE'
    or v_operation.status <> 'PROVIDER_UNKNOWN'
    or v_operation.provider_transfer_id is not null
    or v_operation.final_failure_reference is not null
    or v_operation.funds_return_reference is not null
    or v_operation.funds_return_confirmed_at is not null
  then
    return jsonb_build_object('outcome','NOT_DEFINITE');
  end if;

  select * into v_prior from public.payout_attempts
    where claim_id=p_claim_id
      and claim_operation_id=v_operation.id
      and id<>p_attempt_id
      and provider_evidence->>'definite_rejection'='true'
      and nullif(btrim(provider_evidence->>'stripe_code'),'') is not null
    order by attempt_number desc limit 1 for update;
  if v_prior.id is null then
    return jsonb_build_object('outcome','NOT_DEFINITE');
  end if;
  if nullif(btrim(v_prior.provider_evidence->>'stripe_request_id'),'') is null
    or exists (
      select 1 from public.payout_provider_operations other
      where other.claim_id=v_claim.id and other.id<>v_operation.id
        and other.status in ('TRANSFERRED','WITHDRAWN','LATE_SUCCEEDED')
    )
  then
    return jsonb_build_object('outcome','NOT_DEFINITE');
  end if;

  update public.payout_attempts set
    status='FAILED_RECONCILED',
    provider_evidence=p_reconciliation_evidence||jsonb_build_object(
      'definite_rejection',true,
      'stripe_code',v_prior.provider_evidence->>'stripe_code',
      'stripe_request_id',v_prior.provider_evidence->>'stripe_request_id',
      'rejected_attempt_id',v_prior.id),
    completed_at=now()
  where id=v_attempt.id;

  update public.payout_claims set
    status='FAILED_RECONCILED',transfer_status='FAILED_RECONCILED',
    last_provider_checked_at=now()
  where id=v_claim.id;

  update public.payout_provider_operations set
    status='FAILED_RETURNED',
    final_failure_reference=v_prior.provider_evidence->>'stripe_request_id',
    funds_return_reference='NOT_SENT:'||(v_prior.provider_evidence->>'stripe_code'),
    funds_return_confirmed_at=now()
  where id=v_operation.id;

  insert into public.ops_issues (
    issue_type,severity,status,source,order_id,related_entity_type,
    related_entity_id,provider,title,description,recommended_action,
    dedupe_key,metadata
  ) values (
    'PAYOUT_FAILED','HIGH','OPEN','payout-definite-rejection',v_claim.order_id,
    'PAYOUT_CLAIM',v_claim.id::text,'STRIPE',
    'Stripe payout was rejected before a transfer was created',
    'Stripe returned a definite rejection and the later exact operation lookup found no transfer.',
    'Keep this earning blocked while Ops reviews the provider rejection. Do not reuse the rejected operation key or send a manual transfer.',
    'payout-definite-rejection:'||v_operation.id::text,
    jsonb_build_object('claim_id',v_claim.id,'operation_id',v_operation.id,
      'attempt_id',v_attempt.id,'rejected_attempt_id',v_prior.id,
      'stripe_code',v_prior.provider_evidence->>'stripe_code',
      'stripe_request_id',v_prior.provider_evidence->>'stripe_request_id')
  ) on conflict (dedupe_key) do update set
    status='OPEN',last_seen_at=now(),metadata=excluded.metadata
  returning id into v_issue_id;

  return jsonb_build_object('outcome','FAILED_RECONCILED',
    'claim_id',v_claim.id,'attempt_id',v_attempt.id,'ops_issue_id',v_issue_id);
end;
$$;

revoke all on function public.reconcile_definite_payout_rejection(uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.reconcile_definite_payout_rejection(uuid,uuid,jsonb)
  to service_role;
