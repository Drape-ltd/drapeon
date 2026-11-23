create unique index payout_claims_provider_transfer_unique_idx
  on public.payout_claims(provider, provider_transfer_id)
  where provider_transfer_id is not null;

-- Provider I/O completed before this short transaction starts. An exception or
-- timeout is UNKNOWN, never a terminal failure. Only explicit provider evidence
-- can mark a transfer failed or confirmed.
create function public.record_payout_attempt_outcome(
  p_attempt_id uuid,
  p_status text,
  p_provider_transfer_id text,
  p_evidence jsonb
)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_claim public.payout_claims%rowtype;
  v_attempt public.payout_attempts%rowtype;
  v_claim_id uuid;
  v_late_success boolean := false;
begin
  if p_status not in ('PROVIDER_UNKNOWN','PROVIDER_PENDING','SUCCEEDED','FAILED_RECONCILED')
    or p_evidence is null or jsonb_typeof(p_evidence)<>'object'
    or p_evidence='{}'::jsonb then
    raise exception 'Payout outcome requires a known status and nonempty provider evidence';
  end if;
  if p_status='SUCCEEDED' and nullif(btrim(p_provider_transfer_id),'') is null then
    raise exception 'Confirmed payout needs its provider transfer ID';
  end if;
  if p_status='FAILED_RECONCILED'
    and p_evidence->>'terminal_failure_confirmed' is distinct from 'true' then
    raise exception 'A timeout is not proof that a payout failed';
  end if;
  select claim_id into v_claim_id from public.payout_attempts where id=p_attempt_id;
  if v_claim_id is null then raise exception 'Payout attempt not found'; end if;
  select * into v_claim from public.payout_claims where id=v_claim_id for update;
  select * into v_attempt from public.payout_attempts where id=p_attempt_id for update;
  if v_claim.provider_transfer_id is not null and p_provider_transfer_id is not null
    and v_claim.provider_transfer_id is distinct from p_provider_transfer_id then
    raise exception 'Payout provider transfer ID cannot change';
  end if;
  if v_claim.status in ('TRANSFERRED','WITHDRAWN') then
    if p_status='SUCCEEDED' and v_claim.provider_transfer_id=p_provider_transfer_id then
      return jsonb_build_object('outcome','EXISTING','claim_id',v_claim.id,'status',v_claim.status);
    end if;
    raise exception 'Confirmed payout cannot be downgraded';
  end if;
  if v_attempt.status='SUCCEEDED' and p_status<>'SUCCEEDED' then
    raise exception 'Confirmed payout attempt cannot be downgraded';
  end if;
  if v_attempt.status='FAILED_RECONCILED' and p_status not in ('FAILED_RECONCILED','SUCCEEDED') then
    raise exception 'Reconciled failure cannot become an uncertain outcome';
  end if;
  v_late_success := v_claim.status='FAILED_RECONCILED' and p_status='SUCCEEDED';

  update public.payout_attempts set
    status=p_status,
    provider_operation_id=coalesce(provider_operation_id,nullif(btrim(p_provider_transfer_id),'')),
    provider_evidence=p_evidence,
    completed_at=case when p_status in ('SUCCEEDED','FAILED_RECONCILED') then now() else null end
  where id=p_attempt_id;
  update public.payout_claims set
    status=case p_status
      when 'SUCCEEDED' then 'TRANSFERRED'
      else p_status end,
    transfer_status=case p_status
      when 'SUCCEEDED' then 'CONFIRMED'
      when 'FAILED_RECONCILED' then 'FAILED_RECONCILED'
      when 'PROVIDER_PENDING' then 'PENDING'
      else 'UNKNOWN' end,
    withdrawal_status=case when p_status='SUCCEEDED' and withdrawal_status='NOT_STARTED'
      then 'PENDING' else withdrawal_status end,
    provider_transfer_id=coalesce(provider_transfer_id,nullif(btrim(p_provider_transfer_id),'')),
    last_provider_checked_at=now()
  where id=v_claim.id;

  if v_late_success then
    insert into public.ops_issues (
      issue_type,severity,status,source,order_id,related_entity_type,related_entity_id,
      provider,title,description,recommended_action,dedupe_key,metadata
    ) values (
      'PAYOUT_LATE_SUCCESS','HIGH','OPEN','payout-claim-reconciliation',v_claim.order_id,
      'PAYOUT_CLAIM',v_claim.id::text,v_claim.provider,
      'Payout succeeded after a recorded failure',
      'The provider later confirmed a transfer previously marked failed. Reconcile the ledger and customer/tailor timeline.',
      'Verify the transfer once, correct the payout receipt, and do not submit another transfer.',
      'payout-late-success:'||v_claim.id::text,
      jsonb_build_object('claim_id',v_claim.id,'attempt_id',p_attempt_id,'provider_transfer_id',p_provider_transfer_id)
    ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now();
  end if;
  return jsonb_build_object('outcome','RECORDED','claim_id',v_claim.id,
    'status',case when p_status='SUCCEEDED' then 'TRANSFERRED' else p_status end,
    'late_success',v_late_success);
end;
$$;

revoke execute on function public.record_payout_attempt_outcome(uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_payout_attempt_outcome(uuid,text,text,jsonb)
  to service_role;
