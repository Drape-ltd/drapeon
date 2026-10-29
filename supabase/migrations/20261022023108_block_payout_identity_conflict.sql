-- Persist a transfer/claim identity conflict and its Ops case atomically.
-- No provider call is made while this transaction holds a row lock.
create function public.block_payout_claim_identity_conflict(
  p_attempt_id uuid, p_evidence jsonb
)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
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
  select claim_id into v_claim_id from public.payout_attempts where id = p_attempt_id;
  if v_claim_id is null then raise exception 'Payout attempt not found'; end if;
  select * into v_claim from public.payout_claims where id = v_claim_id for update;
  select * into v_attempt from public.payout_attempts where id = p_attempt_id for update;
  if v_attempt.claim_id <> v_claim.id then raise exception 'Payout attempt claim changed'; end if;
  if v_claim.status in ('TRANSFERRED','WITHDRAWN') or v_attempt.status = 'SUCCEEDED' then
    raise exception 'Confirmed payout requires a separate late-conflict review';
  end if;
  if v_claim.status not in ('PROVIDER_UNKNOWN','PROVIDER_PENDING','BLOCKED') then
    raise exception 'Identity conflict cannot block an unattempted payout';
  end if;
  update public.payout_attempts set status = 'PROVIDER_UNKNOWN',
    provider_evidence = p_evidence, error_class = 'PROVIDER_IDENTITY_CONFLICT'
    where id = p_attempt_id;
  update public.payout_claims set status = 'BLOCKED',
    transfer_status = 'UNKNOWN', last_provider_checked_at = now()
    where id = v_claim.id;
  insert into public.ops_issues (
    issue_type,severity,status,source,order_id,related_entity_type,related_entity_id,
    provider,title,description,recommended_action,dedupe_key,metadata
  ) values (
    'PAYOUT_FAILED','CRITICAL','OPEN','claimed-payout-execution',v_claim.order_id,
    'PAYOUT_CLAIM',v_claim.id::text,v_claim.provider,
    'Provider transfer conflicts with the payout claim',
    'Provider transfer evidence does not match this immutable earning claim.',
    'Reconcile the provider transfer, amount, currency and destination before any further operation.',
    'payout-identity-conflict:' || v_claim.id::text,
    jsonb_build_object('claim_id',v_claim.id,'attempt_id',p_attempt_id)
  ) on conflict (dedupe_key) do update set status = 'OPEN',last_seen_at = now();
  return jsonb_build_object('outcome','BLOCKED','claim_id',v_claim.id);
end;
$$;

revoke execute on function public.block_payout_claim_identity_conflict(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.block_payout_claim_identity_conflict(uuid,jsonb)
  to service_role;
