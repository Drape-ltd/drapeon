create or replace function public.reserve_reviewed_snapshot_tranche_replacement(
  p_tranche_id uuid,
  p_money_desk_request_id uuid,
  p_provider text,
  p_destination_id text,
  p_route_version text
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_request public.money_desk_requests%rowtype;
  v_order public.orders%rowtype;
  v_tranche public.order_settlement_tranches%rowtype;
  v_claim public.payout_claims%rowtype;
  v_payout public.payouts%rowtype;
  v_correction public.payout_destination_corrections%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_destination public.payout_destinations%rowtype;
begin
  select * into v_request from public.money_desk_requests where id=p_money_desk_request_id for share;
  if not found or v_request.status not in ('EXECUTING','SUCCEEDED','FAILED')
    or v_request.action_type<>'PAYOUT_DESTINATION_CHANGE'
    or v_request.target_type<>'ORDER_PAYOUT_FAILURE'
    or v_request.action_payload->>'snapshotCorrection' is distinct from 'true'
    or v_request.action_payload->>'trancheId' is distinct from p_tranche_id::text
    or v_request.action_payload->>'provider' is distinct from p_provider
    or v_request.approval_count<2 or v_request.required_approval_count<>2 then
    raise exception 'The executing correction request does not authorize this tranche operation';
  end if;
  select * into v_order from public.orders where id::text=v_request.order_id for share;
  select * into v_tranche from public.order_settlement_tranches where id=p_tranche_id for update;
  select * into v_claim from public.payout_claims where business_key='tranche:'||p_tranche_id::text for update;
  if not found or v_order.id is null or v_order.accepted_route_snapshot_at is null
    or v_order.payment_route_version::text is distinct from p_route_version
    or v_order.charge_provider_snapshot::text is distinct from p_provider
    or v_tranche.order_id is distinct from v_order.id::text
    or v_tranche.status<>'RELEASE_REQUESTED'
    or v_tranche.money_desk_request_id is distinct from p_money_desk_request_id
    or v_claim.source_kind<>'SETTLEMENT_TRANCHE'
    or v_claim.source_id is distinct from p_tranche_id::text
    or v_claim.order_id is distinct from v_order.id::text
    or v_claim.provider is distinct from p_provider
    or v_claim.status<>'RESERVED'
    or v_claim.transfer_status<>'NOT_STARTED'
    or v_claim.payout_id is null then
    raise exception 'The immutable tranche claim is not reserved for this reviewed replacement';
  end if;
  select * into v_payout from public.payouts where id::text=v_claim.payout_id for update;
  select * into v_destination from public.payout_destinations where id=v_order.payout_destination_id for share;
  select * into v_correction from public.payout_destination_corrections
    where money_desk_request_id=p_money_desk_request_id and claim_id=v_claim.id for share;
  select * into v_operation from public.payout_provider_operations
    where claim_id=v_claim.id and operation_number=v_correction.operation_number for share;
  if v_payout.id is null or v_payout.status<>'PROCESSING'
    or v_payout.settlement_tranche_id is distinct from p_tranche_id
    or v_payout.provider_destination_id is distinct from p_destination_id
    or v_claim.currency is distinct from v_tranche.currency
    or v_claim.amount is distinct from v_tranche.amount
    or v_correction.id is null
    or v_correction.replacement_destination_id is distinct from v_order.payout_destination_id
    or v_correction.correction_transaction_id is null
    or v_destination.id is null or v_destination.provider_account_ref is distinct from p_destination_id
    or v_operation.id is null or v_operation.status<>'RESERVED'
    or v_operation.provider_destination_id is distinct from p_destination_id
    or v_operation.reviewed_correction_id is distinct from v_correction.id
    or v_operation.money_desk_request_id is distinct from v_request.id
    or v_operation.provider_idempotency_key is distinct from v_claim.business_key||':op:'||v_operation.operation_number::text then
    raise exception 'The numbered replacement operation does not match the corrected route and payout';
  end if;
  return jsonb_build_object('outcome','EXISTING','claim_id',v_claim.id,
    'payout_id',v_payout.id,'status',v_claim.status,
    'provider_transfer_id',v_claim.provider_transfer_id,
    'provider_idempotency_key',v_claim.provider_idempotency_key,
    'source_payment_changed',false);
end $$;

revoke execute on function public.reserve_reviewed_snapshot_tranche_replacement(uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.reserve_reviewed_snapshot_tranche_replacement(uuid,uuid,text,text,text)
  to service_role;
