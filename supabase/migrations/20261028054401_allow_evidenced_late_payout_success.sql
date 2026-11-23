-- A provider can report a transfer after its attempt was reconciled, or after
-- a separate operation for the same earning already transferred. Preserve the
-- late receipt only when a linked SUCCEEDED attempt records it; the operation's
-- original transfer reference remains immutable for audit.
create or replace function public.prevent_payout_provider_operation_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_transition_allowed boolean := false;
begin
  if row(new.claim_id, new.operation_number, new.provider, new.provider_destination_id,
         new.currency, new.amount, new.provider_idempotency_key, new.reviewed_correction_id,
         new.money_desk_request_id)
    is distinct from
     row(old.claim_id, old.operation_number, old.provider, old.provider_destination_id,
         old.currency, old.amount, old.provider_idempotency_key, old.reviewed_correction_id,
         old.money_desk_request_id) then
    raise exception 'Provider operation identity cannot change';
  end if;

  if new.status = old.status then
    v_transition_allowed := true;
  else
    v_transition_allowed := case old.status
      when 'RESERVED' then new.status in ('PROVIDER_UNKNOWN','PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED')
      when 'PROVIDER_UNKNOWN' then new.status in ('PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED','LATE_SUCCEEDED')
      when 'PROVIDER_PENDING' then new.status in ('PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED','LATE_SUCCEEDED')
      when 'TRANSFERRED' then new.status in ('WITHDRAWN','LATE_SUCCEEDED')
      when 'WITHDRAWN' then new.status = 'LATE_SUCCEEDED'
      when 'FAILED_RETURNED' then new.status = 'LATE_SUCCEEDED'
      when 'LATE_SUCCEEDED' then false
      else false
    end;
  end if;
  if not v_transition_allowed then
    raise exception 'Invalid provider payout operation transition: % -> %', old.status, new.status;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.guard_payout_provider_operation_outcome()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id text;
  v_has_late_success_receipt boolean := false;
  v_has_other_confirmed_operation boolean := false;
begin
  if old.provider_transfer_id is not null
    and new.provider_transfer_id is distinct from old.provider_transfer_id then
    raise exception 'Confirmed provider transfer reference cannot change';
  end if;
  if old.status in ('WITHDRAWN','LATE_SUCCEEDED') and new.status is distinct from old.status then
    raise exception 'Terminal provider operation outcome cannot be downgraded';
  end if;

  if new.status = 'LATE_SUCCEEDED' and new.status is distinct from old.status then
    select exists (
      select 1 from public.payout_attempts a
      where a.claim_id = new.claim_id
        and a.claim_operation_id = new.id
        and a.status = 'SUCCEEDED'
        and cardinality(a.observed_provider_transfer_ids) > 0
    ) into v_has_late_success_receipt;
    select exists (
      select 1 from public.payout_provider_operations other
      where other.claim_id = new.claim_id and other.id <> new.id
        and other.status in ('TRANSFERRED','WITHDRAWN','LATE_SUCCEEDED')
        and nullif(btrim(other.provider_transfer_id),'') is not null
    ) into v_has_other_confirmed_operation;

    if not v_has_late_success_receipt
      or (old.status in ('TRANSFERRED','WITHDRAWN') and not exists (
        select 1 from public.payout_attempts a
        cross join lateral unnest(a.observed_provider_transfer_ids) observed(transfer_id)
        where a.claim_id = new.claim_id and a.claim_operation_id = new.id
          and a.status = 'SUCCEEDED'
          and observed.transfer_id is distinct from old.provider_transfer_id
      ))
      or (old.status in ('PROVIDER_UNKNOWN','PROVIDER_PENDING')
        and not v_has_other_confirmed_operation)
      or old.status not in ('FAILED_RETURNED','PROVIDER_UNKNOWN','PROVIDER_PENDING','TRANSFERRED','WITHDRAWN') then
      raise exception 'Late success needs a linked success receipt and a returned, conflicting, or concurrently confirmed operation';
    end if;
  elsif new.status = 'LATE_SUCCEEDED' and old.status = 'LATE_SUCCEEDED'
    and not exists (
      select 1 from public.payout_attempts a
      where a.claim_id = new.claim_id and a.claim_operation_id = new.id
        and a.status = 'SUCCEEDED'
        and cardinality(a.observed_provider_transfer_ids) > 0
    ) then
    raise exception 'Repeated late success needs its linked provider receipt';
  end if;

  if old.status = 'FAILED_RETURNED' and new.status = 'LATE_SUCCEEDED' then
    select order_id into v_order_id from public.payout_claims where id=new.claim_id;
    insert into public.ops_issues (
      issue_type,severity,status,source,order_id,related_entity_type,related_entity_id,
      title,description,recommended_action,dedupe_key,metadata
    ) values (
      'PAYOUT_FAILED','CRITICAL','OPEN','payout-provider-operation-late-success',
      v_order_id,'PAYOUT_PROVIDER_OPERATION',new.id::text,
      'A returned transfer later succeeded',
      'The provider confirmed a transfer that was previously recorded as returned. Another operation may exist for the same earning.',
      'Freeze further release, reconcile both provider transfers and available balance, and resolve any duplicate payment through Money Desk.',
      'payout-operation-late-success:'||new.id::text,
      jsonb_build_object('claim_id',new.claim_id,'operation_number',new.operation_number,
        'provider_transfer_id',new.provider_transfer_id)
    ) on conflict (dedupe_key) do update set last_seen_at=now();
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_payout_provider_operation_identity_change()
  from public, anon, authenticated;
revoke all on function public.guard_payout_provider_operation_outcome()
  from public, anon, authenticated;
