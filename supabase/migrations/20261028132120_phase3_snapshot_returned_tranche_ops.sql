-- Keep a confirmed, returned snapshot-tranche payout visible for reviewed recovery.
create or replace function private.sync_returned_snapshot_tranche_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.payout_provider_operations%rowtype;
  v_is_snapshot boolean;
begin
  if new.source_kind <> 'SETTLEMENT_TRANCHE'
    or new.status <> 'FAILED_RECONCILED'
    or new.transfer_status <> 'FAILED_RECONCILED'
    or new.payout_id is null
    or (old.status = new.status and old.transfer_status = new.transfer_status) then
    return new;
  end if;

  select exists (
    select 1 from public.orders o
    where o.id::text = new.order_id and o.accepted_route_snapshot_at is not null
  ) into v_is_snapshot;
  if not v_is_snapshot then return new; end if;

  select * into v_operation
  from public.payout_provider_operations op
  where op.claim_id = new.id
  order by op.operation_number desc
  limit 1;
  if v_operation.id is null or v_operation.status <> 'FAILED_RETURNED'
    or nullif(btrim(v_operation.final_failure_reference), '') is null
    or nullif(btrim(v_operation.funds_return_reference), '') is null
    or v_operation.funds_return_confirmed_at is null then
    return new;
  end if;

  update public.payouts p set
    status = 'FAILED'::public.payout_status,
    provider_transfer_status = 'FAILED',
    bank_settlement_status = 'NOT_APPLICABLE',
    failed_at = coalesce(p.failed_at, v_operation.funds_return_confirmed_at),
    completed_at = null,
    provider_response = coalesce(p.provider_response, '{}'::jsonb) || jsonb_build_object(
      'terminal_outcome', 'FAILED_RETURNED',
      'claim_id', new.id,
      'claim_operation_id', v_operation.id,
      'operation_number', v_operation.operation_number,
      'final_failure_reference', v_operation.final_failure_reference,
      'funds_return_reference', v_operation.funds_return_reference,
      'funds_return_confirmed_at', v_operation.funds_return_confirmed_at
    )
  where p.id_text = new.payout_id
    and p.status in ('PENDING'::public.payout_status, 'PROCESSING'::public.payout_status, 'FAILED'::public.payout_status);

  insert into public.ops_issues as existing_issue (
    issue_type,severity,status,source,order_id,related_entity_type,
    related_entity_id,provider,title,description,recommended_action,
    dedupe_key,metadata
  ) values (
    'PAYOUT_FAILED','HIGH','OPEN','payout-provider-operation-returned',new.order_id,
    'PAYOUT_CLAIM',new.id::text,new.provider,
    'Returned tranche transfer needs reviewed destination recovery',
    'The provider finally failed the tranche transfer and confirmed the funds returned to Drapeon. The accepted earning remains unchanged; any replacement requires a reviewed destination correction.',
    'Confirm the returned balance evidence, then use the two-person reviewed destination-correction workflow if the tailor has a verified replacement.',
    lower(new.provider)||'-tranche-reconcile:'||new.source_id,
    jsonb_build_object('claim_id',new.id,'tranche_id',new.source_id,
      'payout_id',new.payout_id,'provider',new.provider,
      'operation_id',v_operation.id,'operation_number',v_operation.operation_number,
      'payout_currency',new.currency,'terminal_outcome','FAILED_RETURNED')
  ) on conflict (dedupe_key) do update set
    status = 'OPEN',last_seen_at = now(),
    metadata = coalesce(existing_issue.metadata, '{}'::jsonb) || excluded.metadata;

  return new;
end;
$$;

revoke all on function private.sync_returned_snapshot_tranche_payout() from public,anon,authenticated,service_role;
