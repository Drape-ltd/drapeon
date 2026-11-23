drop function if exists public.bind_payout_provider_operation_source_transaction(uuid,text);

do $$
begin
  if exists (
    select 1 from public.payout_provider_operations
    where provider_source_transaction_id is not null
  ) then
    raise exception 'Cannot roll back saved Stripe source transaction identities';
  end if;
end;
$$;

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

alter table public.payout_provider_operations
  drop constraint if exists payout_provider_operations_source_transaction_check;
alter table public.payout_provider_operations
  drop column if exists provider_source_transaction_id;
