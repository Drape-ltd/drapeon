-- Finalize a definitely rejected transfer after the operation evidence is durable.
-- The returned-funds tranche trigger sees the failed operation when the claim closes.
CREATE OR REPLACE FUNCTION public.reconcile_definite_payout_rejection(p_claim_id uuid, p_attempt_id uuid, p_reconciliation_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_attempt public.payout_attempts%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_prior public.payout_attempts%rowtype;
  v_payout public.payouts%rowtype;
  v_tranche public.order_settlement_tranches%rowtype;
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

  update public.payout_provider_operations set
    status='FAILED_RETURNED',
    final_failure_reference=v_prior.provider_evidence->>'stripe_request_id',
    funds_return_reference='NOT_SENT:'||(v_prior.provider_evidence->>'stripe_code'),
    funds_return_confirmed_at=now()
  where id=v_operation.id;

  update public.payout_claims set
    status='FAILED_RECONCILED',transfer_status='FAILED_RECONCILED',
    last_provider_checked_at=now()
  where id=v_claim.id;

  if v_claim.source_kind='SETTLEMENT_TRANCHE' then
    -- The claim trigger has now seen the final operation and closed the payout.
    -- Keep the tranche in the same terminal state so a new reviewed recovery
    -- can be prepared. A mismatch rolls back the entire reconciliation.
    select * into v_payout from public.payouts
      where id_text=v_claim.payout_id for update;
    select * into v_tranche from public.order_settlement_tranches
      where id::text=v_claim.source_id for update;
    if v_payout.id is null or v_tranche.id is null
      or v_payout.status<>'FAILED'
      or v_payout.provider_payout_id is not null
      or v_payout.provider_response->>'terminal_outcome' is distinct from 'FAILED_RETURNED'
      or v_payout.provider_response->>'claim_operation_id' is distinct from v_operation.id::text
      or v_payout.order_id is distinct from v_claim.order_id
      or v_payout.amount is distinct from v_claim.amount
      or v_payout.currency is distinct from v_claim.currency
      or v_tranche.status<>'RELEASE_REQUESTED'
      or v_tranche.order_id is distinct from v_claim.order_id
      or v_tranche.payout_id is distinct from v_payout.id
      or v_tranche.amount is distinct from v_claim.amount
      or v_tranche.currency is distinct from v_claim.currency
      or v_claim.payout_ledger_transaction_id is not null then
      raise exception 'Rejected tranche did not reach a safe unpaid payout state';
    end if;
    update public.order_settlement_tranches set status='BLOCKED',updated_at=now()
      where id=v_tranche.id and status='RELEASE_REQUESTED';
    if not found then
      raise exception 'Rejected tranche changed before close-out';
    end if;
    -- The claim trigger already created the tranche case. Correct its returned-
    -- funds wording for NOT_SENT evidence instead of opening a second case.
    update public.ops_issues set
      status='OPEN',canonical_status='NEW',resolved_at=null,closed_at=null,
      last_seen_at=now(),source='payout-definite-rejection',
      title='Stripe payout was rejected before a transfer was created',
      description='Stripe returned a definite rejection and the exact operation lookup found no transfer. No funds left Drapeon.',
      recommended_action='After Stripe capability is restored, use the reviewed claimed-payout retry for this destination. If payout details must change, use the reviewed destination-correction workflow. Never reuse the rejected operation key or send a manual transfer.',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'claim_id',v_claim.id,'operation_id',v_operation.id,
        'attempt_id',v_attempt.id,'rejected_attempt_id',v_prior.id,
        'stripe_code',v_prior.provider_evidence->>'stripe_code',
        'stripe_request_id',v_prior.provider_evidence->>'stripe_request_id',
        'terminal_outcome','NOT_SENT')
    where dedupe_key=lower(v_claim.provider)||'-tranche-reconcile:'||v_claim.source_id;
    if not found then
      raise exception 'Definite tranche rejection did not create its Ops case';
    end if;
    select id into v_issue_id from public.ops_issues
      where dedupe_key=lower(v_claim.provider)||'-tranche-reconcile:'||v_claim.source_id;
  else
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
  end if;

  return jsonb_build_object('outcome','FAILED_RECONCILED',
    'claim_id',v_claim.id,'attempt_id',v_attempt.id,'ops_issue_id',v_issue_id);
end;
$function$
