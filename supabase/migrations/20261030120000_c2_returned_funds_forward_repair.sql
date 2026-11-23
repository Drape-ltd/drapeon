-- C2 follow-up: a provider-confirmed returned transfer is a forward terminal
-- failure, not an ordinary PAID -> FAILED regression.
create or replace function public.guard_payout_forward_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old text := old.status::text;
  v_new text := new.status::text;
  v_reversal_evidenced boolean := coalesce(current_setting('drape.payout_transfer_reversal', true), '') = 'evidenced';
  v_returned_evidenced boolean := coalesce(current_setting('drape.payout_returned_funds', true), '') = 'evidenced';
  v_reviewed_recovery boolean := false;
begin
  if new.amount is distinct from old.amount or new.currency is distinct from old.currency
     or new.provider is distinct from old.provider then
    raise exception 'PAYOUT_MONEY_IDENTITY_IMMUTABLE';
  end if;
  if old.provider_payout_id is not null and new.provider_payout_id is distinct from old.provider_payout_id then
    raise exception 'PAYOUT_PROVIDER_TRANSFER_ID_IMMUTABLE';
  end if;
  if old.provider_destination_id is not null and new.provider_destination_id is distinct from old.provider_destination_id then
    select exists (
      select 1 from public.payout_destination_corrections correction
      join public.payout_destinations destination on destination.id=correction.replacement_destination_id
      join public.payout_provider_operations operation
        on operation.reviewed_correction_id = correction.id and operation.claim_id=correction.claim_id
      where correction.failed_payout_id::text=old.id::text
        and destination.provider_account_ref=new.provider_destination_id
        and operation.provider_destination_id=new.provider_destination_id
        and operation.operation_number > 1 and operation.status = 'RESERVED'
    ) into v_reviewed_recovery;
    if not v_reviewed_recovery then raise exception 'PAYOUT_DESTINATION_IMMUTABLE'; end if;
  end if;
  new.provider_response := coalesce(old.provider_response,'{}'::jsonb)||coalesce(new.provider_response,'{}'::jsonb);
  if v_old='PAID' and new.completed_at is null and not v_returned_evidenced then
    raise exception 'PAID_PAYOUT_COMPLETION_IMMUTABLE';
  end if;
  if v_old=v_new then return new; end if;
  if v_old='PENDING' and v_new in ('PROCESSING','PAID','FAILED','CANCELED','BLOCKED') then return new; end if;
  if v_old='PROCESSING' and v_new in ('PAID','FAILED','BLOCKED') then return new; end if;
  if v_old in ('PROCESSING','PAID') and v_new='FAILED' and v_returned_evidenced then return new; end if;
  if v_old in ('PROCESSING','PAID') and v_new='REVERSED' and v_reversal_evidenced then return new; end if;
  if v_old in ('FAILED','BLOCKED') and v_new='PROCESSING' then
    if not v_reviewed_recovery then
      select exists (
        select 1 from public.payout_destination_corrections correction
        join public.payout_provider_operations operation
          on operation.reviewed_correction_id = correction.id and operation.claim_id=correction.claim_id
        where correction.failed_payout_id::text=old.id::text
          and operation.operation_number > 1 and operation.status = 'RESERVED'
      ) into v_reviewed_recovery;
    end if;
    if v_reviewed_recovery then return new; end if;
  end if;
  if v_old='BLOCKED' and v_new in ('FAILED','CANCELED') then return new; end if;
  raise exception 'ILLEGAL_PAYOUT_STATUS_TRANSITION:%->%',v_old,v_new;
end;
$$;

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
  if new.source_kind<>'SETTLEMENT_TRANCHE' or new.status<>'FAILED_RECONCILED'
    or new.transfer_status<>'FAILED_RECONCILED' or new.payout_id is null
    or (old.status=new.status and old.transfer_status=new.transfer_status) then return new; end if;
  select exists(select 1 from public.orders o where o.id::text=new.order_id
    and o.accepted_route_snapshot_at is not null) into v_is_snapshot;
  if not v_is_snapshot then return new; end if;
  select * into v_operation from public.payout_provider_operations op
    where op.claim_id=new.id order by op.operation_number desc limit 1;
  if v_operation.id is null or v_operation.status<>'FAILED_RETURNED'
    or nullif(btrim(v_operation.final_failure_reference),'') is null
    or nullif(btrim(v_operation.funds_return_reference),'') is null
    or v_operation.funds_return_confirmed_at is null then return new; end if;

  perform set_config('drape.payout_returned_funds','evidenced',true);
  update public.payouts p set status='FAILED'::public.payout_status,
    provider_transfer_status='FAILED',bank_settlement_status='NOT_APPLICABLE',
    failed_at=coalesce(p.failed_at,v_operation.funds_return_confirmed_at),completed_at=null,
    provider_response=coalesce(p.provider_response,'{}'::jsonb)||jsonb_build_object(
      'terminal_outcome','FAILED_RETURNED','claim_id',new.id,'claim_operation_id',v_operation.id,
      'operation_number',v_operation.operation_number,
      'final_failure_reference',v_operation.final_failure_reference,
      'funds_return_reference',v_operation.funds_return_reference,
      'funds_return_confirmed_at',v_operation.funds_return_confirmed_at)
  where p.id_text=new.payout_id and p.status in ('PENDING','PROCESSING','PAID','FAILED');
  perform set_config('drape.payout_returned_funds','',true);

  insert into public.ops_issues as existing_issue (
    issue_type,severity,status,source,order_id,related_entity_type,related_entity_id,
    provider,title,description,recommended_action,dedupe_key,metadata
  ) values (
    'PAYOUT_FAILED','HIGH','OPEN','payout-provider-operation-returned',new.order_id,
    'PAYOUT_CLAIM',new.id::text,new.provider,'Returned tranche transfer needs reviewed destination recovery',
    'The provider finally failed the tranche transfer and confirmed the funds returned to Drapeon. The accepted earning remains unchanged; any replacement requires a reviewed destination correction.',
    'Confirm the returned balance evidence, then use the two-person reviewed destination-correction workflow if the tailor has a verified replacement.',
    lower(new.provider)||'-tranche-reconcile:'||new.source_id,
    jsonb_build_object('claim_id',new.id,'tranche_id',new.source_id,'payout_id',new.payout_id,
      'provider',new.provider,'operation_id',v_operation.id,'operation_number',v_operation.operation_number,
      'payout_currency',new.currency,'terminal_outcome','FAILED_RETURNED')
  ) on conflict (dedupe_key) do update set status='OPEN',last_seen_at=now(),
    metadata=coalesce(existing_issue.metadata,'{}'::jsonb)||excluded.metadata;
  return new;
exception when others then
  perform set_config('drape.payout_returned_funds','',true);
  raise;
end;
$$;

revoke all on function private.sync_returned_snapshot_tranche_payout()
from public,anon,authenticated,service_role;

