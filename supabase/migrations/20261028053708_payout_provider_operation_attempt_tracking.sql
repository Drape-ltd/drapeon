-- Make the provider-operation row authoritative for each network attempt.
-- The earning claim remains immutable; replacement operations use their own
-- destination, key, attempt link, and transfer reference under that same claim.

alter table public.payout_attempts
  add column observed_provider_transfer_ids text[] not null default '{}';

create or replace function public.start_payout_attempt(p_claim_id uuid, p_mode text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim public.payout_claims%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_attempt public.payout_attempts%rowtype;
  v_number integer;
  v_initial_status text;
begin
  if p_mode not in ('PROVIDER_CALL','RECONCILE') then
    raise exception 'Unknown payout attempt mode';
  end if;
  select * into v_claim from public.payout_claims where id=p_claim_id for update;
  if v_claim.id is null then raise exception 'Payout claim not found'; end if;

  select * into v_operation
    from public.payout_provider_operations
    where claim_id=p_claim_id
    order by operation_number desc
    limit 1 for update;

  -- Claims created before operation tracking keep their exact original key and
  -- transfer reference. A legacy terminal failure is not reconstructed because
  -- it lacks the provider-confirmed funds-return evidence needed for correction.
  if v_operation.id is null and v_claim.status in ('TRANSFERRED','WITHDRAWN')
    and nullif(btrim(v_claim.provider_transfer_id),'') is null then
    raise exception 'Completed payout claim has no provider transfer reference; route it to Ops';
  end if;
  if v_operation.id is null and v_claim.status <> 'FAILED_RECONCILED'
      and v_claim.status <> 'BLOCKED' then
    v_initial_status := case v_claim.status
      when 'PROVIDER_UNKNOWN' then 'PROVIDER_UNKNOWN'
      when 'PROVIDER_PENDING' then 'PROVIDER_PENDING'
      when 'TRANSFERRED' then 'TRANSFERRED'
      when 'WITHDRAWN' then 'WITHDRAWN'
      else 'RESERVED'
    end;
    insert into public.payout_provider_operations (
      claim_id, operation_number, provider, provider_destination_id,
      currency, amount, provider_idempotency_key, status, provider_transfer_id
    ) values (
      v_claim.id, 1, v_claim.provider, v_claim.provider_destination_id,
      v_claim.currency, v_claim.amount, v_claim.provider_idempotency_key,
      v_initial_status, v_claim.provider_transfer_id
    ) returning * into v_operation;
  end if;

  if v_operation.id is not null and (
    v_operation.provider is distinct from v_claim.provider
    or v_operation.currency is distinct from v_claim.currency
    or v_operation.amount is distinct from v_claim.amount
    or (v_operation.operation_number=1 and (
      v_operation.provider_destination_id is distinct from v_claim.provider_destination_id
      or v_operation.provider_idempotency_key is distinct from v_claim.provider_idempotency_key
      or v_operation.reviewed_correction_id is not null
      or v_operation.money_desk_request_id is not null
    ))
    or (v_operation.operation_number>1 and (
      v_operation.provider_idempotency_key is distinct from
        v_claim.business_key||':op:'||v_operation.operation_number::text
      or v_operation.reviewed_correction_id is null
      or v_operation.money_desk_request_id is null
    ))
  ) then
    raise exception 'Payout provider operation conflicts with the immutable claim or reviewed correction';
  end if;

  if v_claim.status='BLOCKED' or v_operation.id is null then
    return jsonb_build_object('action','BLOCKED','claim_id',v_claim.id);
  end if;

  if v_claim.status in ('TRANSFERRED','WITHDRAWN') then
    if v_operation.status not in ('TRANSFERRED','WITHDRAWN')
      or nullif(btrim(v_operation.provider_transfer_id),'') is null then
      raise exception 'Confirmed payout claim has no matching successful provider operation';
    end if;
    return jsonb_build_object(
      'action','DONE','claim_id',v_claim.id,
      'claim_operation_id',v_operation.id,
      'operation_number',v_operation.operation_number,
      'provider_idempotency_key',v_operation.provider_idempotency_key,
      'provider_transfer_id',v_operation.provider_transfer_id,
      'provider',v_operation.provider,
      'provider_destination_id',v_operation.provider_destination_id,
      'currency',v_operation.currency,
      'amount',v_operation.amount,
      'reviewed_correction_id',v_operation.reviewed_correction_id,
      'money_desk_request_id',v_operation.money_desk_request_id
    );
  end if;

  if v_claim.status='FAILED_RECONCILED' then
    return jsonb_build_object('action','BLOCKED','claim_id',v_claim.id);
  end if;

  if (v_claim.status='RESERVED' and p_mode<>'PROVIDER_CALL')
    or (v_claim.status in ('PROVIDER_UNKNOWN','PROVIDER_PENDING') and p_mode<>'RECONCILE') then
    return jsonb_build_object('action','RECONCILE_FIRST','claim_id',v_claim.id,
      'status',v_claim.status);
  end if;

  if v_operation.status in ('TRANSFERRED','WITHDRAWN') then
    return jsonb_build_object(
      'action','DONE','claim_id',v_claim.id,
      'claim_operation_id',v_operation.id,
      'operation_number',v_operation.operation_number,
      'provider_idempotency_key',v_operation.provider_idempotency_key,
      'provider_transfer_id',v_operation.provider_transfer_id,
      'provider',v_operation.provider,
      'provider_destination_id',v_operation.provider_destination_id,
      'currency',v_operation.currency,
      'amount',v_operation.amount,
      'reviewed_correction_id',v_operation.reviewed_correction_id,
      'money_desk_request_id',v_operation.money_desk_request_id
    );
  end if;
  if v_operation.status='FAILED_RETURNED' or v_operation.status='LATE_SUCCEEDED' then
    return jsonb_build_object('action','BLOCKED','claim_id',v_claim.id);
  end if;
  if p_mode='PROVIDER_CALL' and v_operation.status<>'RESERVED' then
    return jsonb_build_object('action','RECONCILE_FIRST','claim_id',v_claim.id,
      'status',v_operation.status);
  end if;
  if p_mode='RECONCILE' and v_operation.status not in ('PROVIDER_UNKNOWN','PROVIDER_PENDING') then
    return jsonb_build_object('action','RECONCILE_FIRST','claim_id',v_claim.id,
      'status',v_operation.status);
  end if;

  select coalesce(max(attempt_number),0)+1 into v_number
    from public.payout_attempts where claim_id=p_claim_id;
  insert into public.payout_attempts(
    claim_id,attempt_number,claim_operation_id,status,provider_evidence
  ) values (
    p_claim_id,v_number,v_operation.id,'PREPARED',
    jsonb_build_object('mode',p_mode,'operation_number',v_operation.operation_number)
  ) returning * into v_attempt;

  if p_mode='PROVIDER_CALL' then
    update public.payout_provider_operations
      set status='PROVIDER_UNKNOWN'
      where id=v_operation.id and status='RESERVED';
    update public.payout_claims set status='PROVIDER_UNKNOWN',transfer_status='UNKNOWN'
      where id=p_claim_id;
  end if;

  return jsonb_build_object(
    'action',p_mode,'claim_id',v_claim.id,'attempt_id',v_attempt.id,
    'claim_operation_id',v_operation.id,'operation_number',v_operation.operation_number,
    'provider_idempotency_key',v_operation.provider_idempotency_key,
    'provider_transfer_id',v_operation.provider_transfer_id,
    'provider',v_operation.provider,
    'provider_destination_id',v_operation.provider_destination_id,
    'currency',v_operation.currency,'amount',v_operation.amount,
    'reviewed_correction_id',v_operation.reviewed_correction_id,
    'money_desk_request_id',v_operation.money_desk_request_id
  );
end;
$$;

create or replace function public.record_payout_attempt_outcome(
  p_attempt_id uuid,
  p_status text,
  p_provider_transfer_id text,
  p_evidence jsonb
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
  v_claim_id uuid;
  v_operation_id uuid;
  v_late_success boolean := false;
  v_other_success boolean := false;
  v_issue_id uuid;
  v_transfer_id text := nullif(btrim(p_provider_transfer_id),'');
  v_effective_status text;
begin
  if p_status not in ('PROVIDER_UNKNOWN','PROVIDER_PENDING','SUCCEEDED','FAILED_RECONCILED')
    or p_evidence is null or jsonb_typeof(p_evidence)<>'object'
    or p_evidence='{}'::jsonb then
    raise exception 'Payout outcome requires a known status and nonempty provider evidence';
  end if;
  if p_provider_transfer_id is not null and v_transfer_id is null then
    raise exception 'Payout provider transfer reference cannot be blank';
  end if;
  if p_status='SUCCEEDED' and v_transfer_id is null then
    raise exception 'Confirmed payout needs its provider transfer ID';
  end if;
  if p_status='FAILED_RECONCILED' and (
    p_evidence->>'terminal_failure_confirmed' is distinct from 'true'
    or p_evidence->>'funds_return_confirmed' is distinct from 'true'
    or nullif(btrim(p_evidence->>'final_failure_reference'),'') is null
    or nullif(btrim(p_evidence->>'funds_return_reference'),'') is null
  ) then
    raise exception 'Payout failure needs final provider failure and funds-return evidence';
  end if;

  select claim_id,claim_operation_id into v_claim_id,v_operation_id
    from public.payout_attempts where id=p_attempt_id;
  if v_claim_id is null then raise exception 'Payout attempt not found'; end if;
  if v_operation_id is null then raise exception 'Payout attempt has no provider operation link'; end if;
  select * into v_claim from public.payout_claims where id=v_claim_id for update;
  select * into v_attempt from public.payout_attempts where id=p_attempt_id for update;
  select * into v_operation from public.payout_provider_operations
    where id=v_operation_id and claim_id=v_claim_id for update;
  if v_operation.id is null then raise exception 'Payout attempt provider operation is missing'; end if;

  if v_operation.status in ('TRANSFERRED','WITHDRAWN') then
    if p_status='SUCCEEDED' and v_operation.provider_transfer_id=v_transfer_id then
      return jsonb_build_object('outcome','EXISTING','claim_id',v_claim.id,
        'claim_operation_id',v_operation.id,'status',v_claim.status);
    end if;
    if p_status<>'SUCCEEDED' then
      raise exception 'Confirmed provider operation cannot be downgraded';
    end if;
  end if;
  if v_attempt.status='SUCCEEDED' and p_status<>'SUCCEEDED' then
    raise exception 'Confirmed payout attempt cannot be downgraded';
  end if;
  if v_attempt.status='FAILED_RECONCILED' and p_status not in ('FAILED_RECONCILED','SUCCEEDED') then
    raise exception 'Reconciled failure cannot become an uncertain outcome';
  end if;
  if p_status='FAILED_RECONCILED' and v_operation.status in ('TRANSFERRED','WITHDRAWN','LATE_SUCCEEDED') then
    raise exception 'Confirmed payout operation requires separate return reconciliation';
  end if;

  v_effective_status := p_status;
  if p_status='PROVIDER_UNKNOWN' and v_claim.status='PROVIDER_PENDING' then
    -- A failed status lookup is not evidence that a known pending transfer
    -- stopped being pending. Preserve the last provider-confirmed state.
    v_effective_status := 'PROVIDER_PENDING';
  end if;

  select exists (
    select 1 from public.payout_provider_operations other
    where other.claim_id=v_claim.id and other.id<>v_operation.id
      and other.status in ('TRANSFERRED','WITHDRAWN','LATE_SUCCEEDED')
  ) into v_other_success;
  v_late_success := p_status='SUCCEEDED' and (
    v_operation.status='FAILED_RETURNED'
    or v_operation.status='LATE_SUCCEEDED'
    or v_claim.status='BLOCKED'
    or v_other_success
    or (v_operation.provider_transfer_id is not null
      and v_operation.provider_transfer_id is distinct from v_transfer_id)
    or (v_attempt.provider_operation_id is not null
      and v_attempt.provider_operation_id is distinct from v_transfer_id)
  );

  update public.payout_attempts set
    status=p_status,
    provider_operation_id=coalesce(provider_operation_id,v_transfer_id),
    observed_provider_transfer_ids=case
      when v_transfer_id is null
        or v_transfer_id = any(observed_provider_transfer_ids)
        then observed_provider_transfer_ids
      else array_append(observed_provider_transfer_ids,v_transfer_id)
    end,
    provider_evidence=p_evidence,
    completed_at=case when p_status in ('SUCCEEDED','FAILED_RECONCILED') then now() else null end
  where id=p_attempt_id;

  update public.payout_provider_operations set
    status=case
      when p_status='SUCCEEDED' and v_late_success then 'LATE_SUCCEEDED'
      when p_status='SUCCEEDED' then 'TRANSFERRED'
      when p_status='FAILED_RECONCILED' then 'FAILED_RETURNED'
      when v_effective_status='PROVIDER_PENDING' then 'PROVIDER_PENDING'
      else 'PROVIDER_UNKNOWN'
    end,
    provider_transfer_id=coalesce(provider_transfer_id,v_transfer_id),
    final_failure_reference=case when p_status='FAILED_RECONCILED'
      then nullif(btrim(p_evidence->>'final_failure_reference'),'') else final_failure_reference end,
    funds_return_reference=case when p_status='FAILED_RECONCILED'
      then nullif(btrim(p_evidence->>'funds_return_reference'),'') else funds_return_reference end,
    funds_return_confirmed_at=case when p_status='FAILED_RECONCILED'
      then now() else funds_return_confirmed_at end
  where id=v_operation.id;

  if v_late_success then
    update public.payout_claims set status='BLOCKED',transfer_status='UNKNOWN',last_provider_checked_at=now()
      where id=v_claim.id;
    insert into public.ops_issues (
      issue_type,severity,status,source,order_id,related_entity_type,related_entity_id,
      provider,title,description,recommended_action,dedupe_key,metadata
    ) values (
      'PAYOUT_LATE_SUCCESS','CRITICAL','OPEN','payout-claim-operation-reconciliation',v_claim.order_id,
      'PAYOUT_CLAIM',v_claim.id::text,v_operation.provider,
      'Payout succeeded after a replacement operation was authorized',
      'A provider transfer succeeded after its operation was finally returned, or another operation for the same earning has also succeeded. Both transfer records are preserved and the earning is blocked from automatic completion.',
      'Reconcile every provider operation and the available balance. Do not create another transfer or change the accepted earning.',
      'payout-operation-late-success:'||v_operation.id::text,
      jsonb_build_object('claim_id',v_claim.id,'operation_id',v_operation.id,
        'operation_number',v_operation.operation_number,'attempt_id',p_attempt_id,
        'provider_transfer_id',v_transfer_id,'evidence',p_evidence)
    ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now(),metadata=excluded.metadata
    returning id into v_issue_id;
    return jsonb_build_object('outcome','RECORDED','claim_id',v_claim.id,
      'claim_operation_id',v_operation.id,'status','BLOCKED','late_success',true,
      'ops_issue_id',v_issue_id);
  end if;

  -- Another operation may have been blocked while this attempt was already in
  -- flight. Preserve the block until Ops has reconciled every live provider op.
  if v_claim.status='BLOCKED' then
    return jsonb_build_object('outcome','RECORDED','claim_id',v_claim.id,
      'claim_operation_id',v_operation.id,'status','BLOCKED','late_success',false);
  end if;

  update public.payout_claims set
    status=case when p_status='SUCCEEDED' then 'TRANSFERRED' else v_effective_status end,
    transfer_status=case v_effective_status
      when 'SUCCEEDED' then 'CONFIRMED'
      when 'FAILED_RECONCILED' then 'FAILED_RECONCILED'
      when 'PROVIDER_PENDING' then 'PENDING'
      else 'UNKNOWN' end,
    withdrawal_status=case when p_status='SUCCEEDED' and withdrawal_status='NOT_STARTED'
      then 'PENDING' else withdrawal_status end,
    provider_transfer_id=case when p_status='SUCCEEDED'
      then v_transfer_id else provider_transfer_id end,
    last_provider_checked_at=now()
  where id=v_claim.id;

  return jsonb_build_object('outcome','RECORDED','claim_id',v_claim.id,
    'claim_operation_id',v_operation.id,
    'status',case when p_status='SUCCEEDED' then 'TRANSFERRED' else v_effective_status end,
    'late_success',false);
end;
$$;

revoke execute on function public.start_payout_attempt(uuid,text) from public,anon,authenticated;
grant execute on function public.start_payout_attempt(uuid,text) to service_role;
revoke execute on function public.record_payout_attempt_outcome(uuid,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.record_payout_attempt_outcome(uuid,text,text,jsonb)
  to service_role;
revoke all on function public.prevent_payout_provider_operation_identity_change()
  from public,anon,authenticated;
