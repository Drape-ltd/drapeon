alter table public.payout_provider_operations
  add column if not exists provider_source_transaction_id text;

alter table public.payout_provider_operations
  drop constraint if exists payout_provider_operations_source_transaction_check;
alter table public.payout_provider_operations
  add constraint payout_provider_operations_source_transaction_check
  check (provider_source_transaction_id is null
    or provider_source_transaction_id ~ '^ch_[A-Za-z0-9_-]+$');

create or replace function public.prevent_payout_provider_operation_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_transition_allowed boolean := false;
  v_source_bind boolean := false;
begin
  v_source_bind := old.provider_source_transaction_id is null
    and new.provider_source_transaction_id ~ '^ch_[A-Za-z0-9_-]+$'
    and old.provider = 'STRIPE'
    and old.status = 'PROVIDER_UNKNOWN'
    and current_setting('app.bind_payout_source_transaction', true) = 'on';

  if row(new.claim_id, new.operation_number, new.provider, new.provider_destination_id,
         new.currency, new.amount, new.provider_idempotency_key, new.reviewed_correction_id,
         new.money_desk_request_id)
    is distinct from
     row(old.claim_id, old.operation_number, old.provider, old.provider_destination_id,
         old.currency, old.amount, old.provider_idempotency_key, old.reviewed_correction_id,
         old.money_desk_request_id)
    or (new.provider_source_transaction_id is distinct from old.provider_source_transaction_id
      and not v_source_bind) then
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

create or replace function public.bind_payout_provider_operation_source_transaction(
  p_operation_id uuid,
  p_source_transaction_id text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_operation public.payout_provider_operations%rowtype;
begin
  if p_source_transaction_id !~ '^ch_[A-Za-z0-9_-]+$' then
    raise exception 'Stripe source transaction is invalid';
  end if;
  select * into v_operation
  from public.payout_provider_operations
  where id = p_operation_id
  for update;
  if v_operation.id is null then raise exception 'Payout provider operation not found'; end if;
  if v_operation.provider <> 'STRIPE' then raise exception 'Only Stripe operations have a source transaction'; end if;
  if v_operation.provider_source_transaction_id is not null then
    if v_operation.provider_source_transaction_id <> p_source_transaction_id then
      raise exception 'Stripe source transaction conflicts with the saved operation';
    end if;
    return v_operation.provider_source_transaction_id;
  end if;
  if v_operation.status <> 'PROVIDER_UNKNOWN' then
    raise exception 'Stripe source transaction can only be bound before the first provider request';
  end if;
  perform set_config('app.bind_payout_source_transaction', 'on', true);
  update public.payout_provider_operations
  set provider_source_transaction_id = p_source_transaction_id
  where id = p_operation_id;
  perform set_config('app.bind_payout_source_transaction', 'off', true);
  return p_source_transaction_id;
exception when others then
  perform set_config('app.bind_payout_source_transaction', 'off', true);
  raise;
end;
$$;

revoke all on function public.prevent_payout_provider_operation_identity_change()
  from public, anon, authenticated;
revoke all on function public.bind_payout_provider_operation_source_transaction(uuid,text)
  from public, anon, authenticated;
grant execute on function public.bind_payout_provider_operation_source_transaction(uuid,text)
  to service_role;
