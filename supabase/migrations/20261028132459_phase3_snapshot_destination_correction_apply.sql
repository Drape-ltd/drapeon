create or replace function public.apply_reviewed_snapshot_payout_destination_correction(
  p_money_desk_request_id uuid,
  p_actor_email text,
  p_actor_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.money_desk_requests%rowtype;
  v_order public.orders%rowtype;
  v_route public.payment_routes%rowtype;
  v_old_destination public.payout_destinations%rowtype;
  v_new_destination public.payout_destinations%rowtype;
  v_payout public.payouts%rowtype;
  v_claim public.payout_claims%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_tranche public.order_settlement_tranches%rowtype;
  v_existing public.payout_destination_corrections%rowtype;
  v_destination_id uuid;
  v_operation_number integer;
  v_correction_id uuid;
  v_approval_count integer;
  v_approval_row_count integer;
begin
  if coalesce(char_length(trim(p_actor_email)),0)<3
    or upper(trim(p_actor_role)) not in ('FINANCE','ADMIN') then
    raise exception 'A named Finance or Admin executor is required';
  end if;

  select * into v_request from public.money_desk_requests
    where id=p_money_desk_request_id for update;
  if not found or v_request.action_type<>'PAYOUT_DESTINATION_CHANGE'
    or v_request.target_type<>'ORDER_PAYOUT_FAILURE'
    or v_request.status<>'EXECUTING' or v_request.order_id is null
    or v_request.action_payload->>'snapshotCorrection' is distinct from 'true' then
    raise exception 'The executing request is not a snapshot payout-destination correction';
  end if;
  select * into v_existing from public.payout_destination_corrections
    where money_desk_request_id=v_request.id and claim_id is not null;
  if found then
    return jsonb_build_object('correctionId',v_existing.id,'claimId',v_existing.claim_id,
      'operationNumber',v_existing.operation_number,'orderId',v_existing.order_id,
      'payoutId',v_existing.failed_payout_id,'trancheId',v_request.action_payload->>'trancheId',
      'alreadyApplied',true);
  end if;
  if v_request.required_approval_count<>2 or v_request.approval_count<2 then
    raise exception 'Snapshot destination correction requires two independent approvals';
  end if;
  select count(*), count(distinct d.approver_subject)
    into v_approval_row_count, v_approval_count
    from public.money_desk_decisions d
    where d.request_id=v_request.id and d.decision='APPROVE'
      and d.approver_subject is distinct from v_request.requester_subject;
  if v_approval_row_count<>2 or v_approval_count<>2 then
    raise exception 'Two distinct non-requester approvers are required';
  end if;

  select * into v_order from public.orders where id::text=v_request.order_id for update;
  if not found or v_order.accepted_route_snapshot_at is null
    or v_order.payout_destination_id is null then
    raise exception 'The order has no accepted payout destination snapshot';
  end if;
  if v_order.escrow_released then raise exception 'The order earning has already been fully released'; end if;

  select * into v_payout from public.payouts
    where id::text=v_request.target_id and order_id::text=v_order.id::text for update;
  if not found or v_payout.status<>'FAILED'
    or v_payout.payout_purpose<>'SETTLEMENT_TRANCHE'
    or v_payout.settlement_tranche_id is null then
    raise exception 'Only a failed accepted-route tranche payout can be corrected here';
  end if;
  select * into v_claim from public.payout_claims where payout_id=v_payout.id::text for update;
  if not found or v_claim.source_kind<>'SETTLEMENT_TRANCHE'
    or v_claim.source_id is distinct from v_payout.settlement_tranche_id::text
    or v_claim.order_id is distinct from v_order.id::text
    or v_claim.provider is distinct from v_order.charge_provider_snapshot::text
    or v_claim.currency is distinct from v_payout.currency
    or v_claim.amount is distinct from v_payout.amount
    or v_claim.status<>'FAILED_RECONCILED'
    or v_claim.transfer_status<>'FAILED_RECONCILED'
    or v_claim.provider_transfer_id is not null then
    raise exception 'The immutable payout claim is not in a reconciled, replaceable state';
  end if;

  select * into v_operation from public.payout_provider_operations
    where claim_id=v_claim.id order by operation_number desc limit 1 for update;
  if not found or v_operation.status<>'FAILED_RETURNED'
    or v_operation.provider is distinct from v_claim.provider
    or v_operation.amount is distinct from v_claim.amount
    or v_operation.currency is distinct from v_claim.currency
    or nullif(btrim(v_operation.final_failure_reference),'') is null
    or nullif(btrim(v_operation.funds_return_reference),'') is null
    or v_operation.funds_return_confirmed_at is null then
    raise exception 'The latest provider operation lacks final failure and returned-funds evidence';
  end if;
  if exists (select 1 from public.payout_provider_operations op
      where op.claim_id=v_claim.id and op.id<>v_operation.id
        and op.status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING','TRANSFERRED','WITHDRAWN','LATE_SUCCEEDED')) then
    raise exception 'Another provider operation is live or succeeded for this earning';
  end if;
  if exists (select 1 from public.disputes d where d.order_id::text=v_order.id::text
      and d.status::text in ('OPEN','UNDER_REVIEW'))
    or exists (select 1 from public.order_payment_refund_claims r
      where r.order_id=v_order.id::text
        and r.status in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING')) then
    raise exception 'An open dispute or refund operation blocks destination correction';
  end if;

  v_destination_id := nullif(v_request.action_payload->>'replacementDestinationId','')::uuid;
  if v_destination_id is null
    or v_request.action_payload->>'failedPayoutId' is distinct from v_payout.id::text
    or v_request.action_payload->>'claimId' is distinct from v_claim.id::text
    or v_request.action_payload->>'failedOperationId' is distinct from v_operation.id::text
    or v_request.action_payload->>'trancheId' is distinct from v_payout.settlement_tranche_id::text
    or v_request.action_payload->>'previousDestinationId' is distinct from v_order.payout_destination_id::text then
    raise exception 'The reviewed correction snapshot does not match the failed claim';
  end if;
  select * into v_route from public.payment_routes
    where id=v_order.payment_route_id and version=v_order.payment_route_version;
  select * into v_old_destination from public.payout_destinations
    where id=v_order.payout_destination_id;
  select * into v_new_destination from public.payout_destinations
    where id=v_destination_id for share;
  if v_route.id is null or v_old_destination.id is null or v_new_destination.id is null
    or v_old_destination.provider is distinct from v_claim.provider
    or v_new_destination.provider is distinct from v_claim.provider
    or v_new_destination.tailor_profile_id::text is distinct from v_order.tailor_profile_id::text
    or v_new_destination.legal_entity is distinct from v_order.legal_entity_snapshot
    or v_new_destination.country_code is distinct from v_route.tailor_country_code
    or v_new_destination.currency is distinct from v_claim.currency::text
    or v_new_destination.fees_collector is distinct from v_route.fees_collector
    or not v_new_destination.active or not v_new_destination.transfers_enabled
    or not v_new_destination.payouts_enabled
    or v_new_destination.first_withdrawal_review_status<>'CLEARED'
    or v_new_destination.capability_checked_at is null
    or v_new_destination.capability_checked_at<now()-interval '15 minutes'
    or v_new_destination.id=v_order.payout_destination_id then
    raise exception 'The replacement destination is not verified for this immutable route';
  end if;
  if v_request.action_payload->>'provider' is distinct from v_claim.provider
    or v_request.action_payload->>'currency' is distinct from v_claim.currency::text
    or v_request.action_payload->>'previousDestinationFingerprint' is distinct from
      encode(extensions.digest(v_claim.provider||':'||v_old_destination.provider_account_ref,'sha256'),'hex')
    or v_request.action_payload->>'replacementDestinationFingerprint' is distinct from
      encode(extensions.digest(v_claim.provider||':'||v_new_destination.provider_account_ref,'sha256'),'hex') then
    raise exception 'The reviewed destination identity changed; prepare a new request';
  end if;
  v_operation_number := v_operation.operation_number+1;
  if v_operation_number not between 2 and 3 then
    raise exception 'The maximum number of replacement operations has been reached';
  end if;
  select * into v_tranche from public.order_settlement_tranches
    where id::text=v_claim.source_id and order_id=v_order.id::text for update;
  if not found or v_tranche.amount is distinct from v_claim.amount
    or v_tranche.currency is distinct from v_claim.currency
    or v_tranche.payout_id is distinct from v_payout.id::text then
    raise exception 'The failed payout no longer matches its settlement tranche';
  end if;

  insert into public.payout_destination_corrections (
    money_desk_request_id,order_id,failed_payout_id,tailor_profile_id,provider,
    previous_destination_fingerprint,replacement_destination_fingerprint,
    applied_by,correlation_id,claim_id,operation_number,previous_destination_id,
    replacement_destination_id,correction_transaction_id
  ) values (
    v_request.id,v_order.id::text,v_payout.id::text,v_order.tailor_profile_id::text,
    v_claim.provider::public.payment_provider,
    v_request.action_payload->>'previousDestinationFingerprint',
    v_request.action_payload->>'replacementDestinationFingerprint',
    lower(trim(p_actor_email)),v_request.correlation_id,v_claim.id,v_operation_number,
    v_order.payout_destination_id,v_new_destination.id,txid_current()
  ) returning id into v_correction_id;

  insert into public.payout_provider_operations (
    claim_id,operation_number,provider,provider_destination_id,currency,amount,
    provider_idempotency_key,status,reviewed_correction_id,money_desk_request_id
  ) values (
    v_claim.id,v_operation_number,v_claim.provider,v_new_destination.provider_account_ref,
    v_claim.currency,v_claim.amount,v_claim.business_key||':op:'||v_operation_number::text,
    'RESERVED',v_correction_id,v_request.id
  );

  update public.payout_claims set status='RESERVED',transfer_status='NOT_STARTED',
    withdrawal_status='NOT_STARTED',last_provider_checked_at=now()
    where id=v_claim.id and status='FAILED_RECONCILED';
  if not found then raise exception 'The payout claim changed before the replacement could be reserved'; end if;
  update public.payouts set status='PROCESSING',provider_transfer_status='PROCESSING',
    provider_destination_id=v_new_destination.provider_account_ref,
    bank_settlement_status=case when v_claim.provider='STRIPE' then 'PENDING' else 'NOT_APPLICABLE' end,
    failed_at=null,completed_at=null,provider_response=coalesce(provider_response,'{}'::jsonb)||
      jsonb_build_object('destination_correction_id',v_correction_id,
        'supersedes_operation_id',v_operation.id,'replacement_operation_number',v_operation_number,
        'money_desk_request_id',v_request.id)
    where id=v_payout.id and status='FAILED';
  if not found then raise exception 'The payout row changed before the replacement could be reserved'; end if;
  update public.order_settlement_tranches set status='RELEASE_REQUESTED',
    money_desk_request_id=v_request.id,updated_at=now()
    where id=v_tranche.id and payout_id=v_payout.id::text
      and status in ('BLOCKED','RELEASE_REQUESTED','ELIGIBLE');
  if not found then raise exception 'The tranche is not in a recoverable release state'; end if;

  perform set_config('app.reviewed_snapshot_payout_destination_correction','on',true);
  update public.orders set payout_destination_id=v_new_destination.id,updated_at=now()
    where id=v_order.id;
  perform set_config('app.reviewed_snapshot_payout_destination_correction','off',true);

  insert into public.money_desk_events (
    request_id,event_type,actor_email,actor_role,payload,correlation_id
  ) values (
    v_request.id,'EXECUTION_STARTED',lower(trim(p_actor_email)),upper(trim(p_actor_role)),
    jsonb_build_object('step','SNAPSHOT_PAYOUT_DESTINATION_CORRECTED',
      'correction_id',v_correction_id,'claim_id',v_claim.id,
      'failed_payout_id',v_payout.id,'failed_operation_id',v_operation.id,
      'replacement_operation_number',v_operation_number,
      'previous_destination_id',v_order.payout_destination_id,
      'replacement_destination_id',v_new_destination.id,
      'destination_fingerprints_only',true),v_request.correlation_id
  );
  return jsonb_build_object('correctionId',v_correction_id,'claimId',v_claim.id,
    'operationNumber',v_operation_number,'orderId',v_order.id,
    'payoutId',v_payout.id,'trancheId',v_tranche.id,'alreadyApplied',false);
end;
$$;

revoke all on function public.apply_reviewed_snapshot_payout_destination_correction(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_reviewed_snapshot_payout_destination_correction(uuid,text,text)
  to service_role;
