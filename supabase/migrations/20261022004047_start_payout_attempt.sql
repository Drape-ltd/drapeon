-- This RPC allocates a worker action but never waits on a provider request.
-- A crash immediately after commit leaves the claim UNKNOWN; recovery must
-- reconcile or replay the *same* provider key, never mint a second one.
create function public.start_payout_attempt(p_claim_id uuid, p_mode text)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_claim public.payout_claims%rowtype;
  v_attempt public.payout_attempts%rowtype;
  v_number integer;
begin
  if p_mode not in ('PROVIDER_CALL','RECONCILE') then
    raise exception 'Unknown payout attempt mode';
  end if;
  select * into v_claim from public.payout_claims where id=p_claim_id for update;
  if v_claim.id is null then raise exception 'Payout claim not found'; end if;
  if v_claim.status in ('TRANSFERRED','WITHDRAWN') then
    return jsonb_build_object('action','DONE','claim_id',v_claim.id,
      'provider_transfer_id',v_claim.provider_transfer_id);
  end if;
  if v_claim.status='BLOCKED' then
    return jsonb_build_object('action','BLOCKED','claim_id',v_claim.id);
  end if;
  if (v_claim.status in ('RESERVED','FAILED_RECONCILED') and p_mode<>'PROVIDER_CALL')
    or (v_claim.status in ('PROVIDER_UNKNOWN','PROVIDER_PENDING') and p_mode<>'RECONCILE') then
    return jsonb_build_object('action','RECONCILE_FIRST','claim_id',v_claim.id,
      'status',v_claim.status);
  end if;
  select coalesce(max(attempt_number),0)+1 into v_number
    from public.payout_attempts where claim_id=p_claim_id;
  insert into public.payout_attempts(claim_id,attempt_number,status,provider_evidence)
    values(p_claim_id,v_number,'PREPARED',jsonb_build_object('mode',p_mode))
    returning * into v_attempt;
  if p_mode='PROVIDER_CALL' then
    update public.payout_claims set status='PROVIDER_UNKNOWN',transfer_status='UNKNOWN'
      where id=p_claim_id;
  end if;
  return jsonb_build_object('action',p_mode,'claim_id',v_claim.id,
    'attempt_id',v_attempt.id,'attempt_number',v_number,
    'provider_idempotency_key',v_claim.provider_idempotency_key,
    'provider_transfer_id',v_claim.provider_transfer_id);
end;
$$;

revoke execute on function public.start_payout_attempt(uuid,text) from public, anon, authenticated;
grant execute on function public.start_payout_attempt(uuid,text) to service_role;
