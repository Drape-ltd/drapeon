-- The replacement-only outcome guard must not reinterpret operation 1 as a
-- replacement merely because it now has the authoritative operation link.
create or replace function public.guard_replacement_attempt_outcome_until_recorder()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_operation public.payout_provider_operations%rowtype;
begin
  if old.claim_operation_id is null or
    row(new.status,new.provider_operation_id,new.provider_evidence,
        new.error_class,new.completed_at)
    is not distinct from
    row(old.status,old.provider_operation_id,old.provider_evidence,
        old.error_class,old.completed_at) then
    return new;
  end if;

  select * into v_operation from public.payout_provider_operations
    where id=old.claim_operation_id;
  if v_operation.id is null then
    raise exception 'Payout attempt operation is missing';
  end if;
  if v_operation.operation_number=1 then
    return new;
  end if;
  if v_operation.operation_number not between 2 and 3
    or new.status<>'SUCCEEDED'
    or v_operation.status not in ('TRANSFERRED','LATE_SUCCEEDED')
    or new.provider_operation_id is distinct from v_operation.provider_transfer_id
    or new.provider_evidence->>'transfer_id' is distinct from v_operation.provider_transfer_id
    or new.provider_evidence->>'provider_operation_id' is distinct from v_operation.id::text
    or new.provider_evidence->>'claim_id' is distinct from v_operation.claim_id::text
    or new.error_class is not null or new.completed_at is null then
    raise exception 'Numbered replacement needs its dedicated provider outcome recorder';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_replacement_attempt_outcome_until_recorder()
  from public, anon, authenticated;
