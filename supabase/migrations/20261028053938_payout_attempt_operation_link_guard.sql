-- Allow a one-time, evidence-backed link from historical attempts to their
-- provider operation. All linked attempts must still match the immutable claim.
create or replace function public.verify_replacement_attempt_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim public.payout_claims%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_linking boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.claim_operation_id is distinct from old.claim_operation_id then
      if old.claim_operation_id is not null or new.claim_operation_id is null then
        raise exception 'Payout attempt operation link cannot be changed or removed';
      end if;
      v_linking := true;
    end if;
  end if;

  if new.claim_operation_id is null then
    return new;
  end if;

  select * into v_claim from public.payout_claims where id = new.claim_id;
  select * into v_operation from public.payout_provider_operations
    where id = new.claim_operation_id;
  if v_claim.id is null or v_operation.id is null
    or v_operation.claim_id is distinct from new.claim_id
    or v_operation.operation_number not between 1 and 3
    or v_operation.provider is distinct from v_claim.provider
    or v_operation.currency is distinct from v_claim.currency
    or v_operation.amount is distinct from v_claim.amount
    or (v_operation.operation_number = 1 and (
      v_operation.provider_destination_id is distinct from v_claim.provider_destination_id
      or v_operation.provider_idempotency_key is distinct from v_claim.provider_idempotency_key
      or v_operation.reviewed_correction_id is not null
      or v_operation.money_desk_request_id is not null
    ))
    or (v_operation.operation_number > 1 and (
      v_operation.provider_idempotency_key is distinct from
        v_claim.business_key || ':op:' || v_operation.operation_number::text
      or v_operation.reviewed_correction_id is null
      or v_operation.money_desk_request_id is null
    )) then
    raise exception 'Payout attempt does not match its immutable provider operation';
  end if;

  if v_linking then
    if new.status = 'SUCCEEDED' then
      if nullif(btrim(new.provider_operation_id), '') is null
        or new.provider_operation_id is distinct from v_operation.provider_transfer_id
        or v_operation.status not in ('TRANSFERRED','WITHDRAWN','LATE_SUCCEEDED') then
        raise exception 'Historical successful attempt needs the exact confirmed provider transfer';
      end if;
    elsif new.provider_evidence->>'operation_number' is distinct from v_operation.operation_number::text
      or v_operation.status not in ('RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING','FAILED_RETURNED') then
      raise exception 'Historical uncertain attempt needs its exact active provider operation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.verify_replacement_attempt_identity()
  from public, anon, authenticated;
