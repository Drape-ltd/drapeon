-- Tighten provider-operation state only after the separate exact-link backfill.
do $$
begin
  if exists (
    select 1 from public.payout_claims c
    where c.status in ('TRANSFERRED', 'WITHDRAWN')
      and c.transfer_status = 'CONFIRMED'
      and exists (select 1 from public.payout_provider_operations any_op where any_op.claim_id = c.id)
      and not exists (
        select 1 from public.payout_provider_operations o
        where o.claim_id = c.id and o.status in ('TRANSFERRED', 'WITHDRAWN')
          and o.provider_transfer_id = c.provider_transfer_id
          and o.provider = c.provider
          and o.provider_destination_id = c.provider_destination_id
          and o.currency = c.currency
          and o.amount = c.amount
          and o.provider_idempotency_key = c.provider_idempotency_key
      )
  ) then
    raise exception 'A completed claim has a conflicting provider operation; route it to Ops before enabling payout guards';
  end if;
end $$;

alter table public.payout_provider_operations
  add constraint payout_provider_operations_confirmed_transfer_check
  check (status not in ('TRANSFERRED', 'WITHDRAWN', 'LATE_SUCCEEDED')
    or nullif(btrim(provider_transfer_id), '') is not null);

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
      when 'PROVIDER_UNKNOWN' then new.status in ('PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED')
      when 'PROVIDER_PENDING' then new.status in ('PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED')
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

revoke all on function public.prevent_payout_provider_operation_identity_change()
  from public, anon, authenticated;
