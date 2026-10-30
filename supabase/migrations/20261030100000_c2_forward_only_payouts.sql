-- C2: payout status and pinned transfer identity are forward-only.
create or replace function public.guard_payout_forward_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old text := old.status::text;
  v_new text := new.status::text;
  v_reversal_evidenced boolean := coalesce(current_setting('drape.payout_transfer_reversal', true), '') = 'evidenced';
  v_reviewed_recovery boolean := false;
begin
  if new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.provider is distinct from old.provider then
    raise exception 'PAYOUT_MONEY_IDENTITY_IMMUTABLE';
  end if;
  if old.provider_payout_id is not null
     and new.provider_payout_id is distinct from old.provider_payout_id then
    raise exception 'PAYOUT_PROVIDER_TRANSFER_ID_IMMUTABLE';
  end if;

  if old.provider_destination_id is not null
     and new.provider_destination_id is distinct from old.provider_destination_id then
    select exists (
      select 1
      from public.payout_destination_corrections correction
      join public.payout_destinations destination
        on destination.id = correction.replacement_destination_id
      join public.payout_provider_operations operation
        on operation.reviewed_correction_id = correction.id
       and operation.claim_id = correction.claim_id
      where correction.failed_payout_id::text = old.id::text
        and destination.provider_account_ref = new.provider_destination_id
        and operation.provider_destination_id = new.provider_destination_id
        and operation.operation_number > 1
        and operation.status = 'RESERVED'
    ) into v_reviewed_recovery;
    if not v_reviewed_recovery then
      raise exception 'PAYOUT_DESTINATION_IMMUTABLE';
    end if;
  end if;

  -- Evidence is additive even when legacy callers still send a replacement.
  new.provider_response := coalesce(old.provider_response, '{}'::jsonb)
    || coalesce(new.provider_response, '{}'::jsonb);

  if v_old = 'PAID' and new.completed_at is null then
    raise exception 'PAID_PAYOUT_COMPLETION_IMMUTABLE';
  end if;
  if v_old = v_new then return new; end if;

  if v_old = 'PENDING' and v_new in ('PROCESSING','PAID','FAILED','CANCELED','BLOCKED') then
    return new;
  end if;
  if v_old = 'PROCESSING' and v_new in ('PAID','FAILED','BLOCKED') then
    return new;
  end if;
  if v_old in ('PROCESSING','PAID') and v_new = 'REVERSED' and v_reversal_evidenced then
    return new;
  end if;
  if v_old in ('FAILED','BLOCKED') and v_new = 'PROCESSING' then
    if not v_reviewed_recovery then
      select exists (
        select 1
        from public.payout_destination_corrections correction
        join public.payout_provider_operations operation
          on operation.reviewed_correction_id = correction.id
         and operation.claim_id = correction.claim_id
        where correction.failed_payout_id::text = old.id::text
          and operation.operation_number > 1
          and operation.status = 'RESERVED'
      ) into v_reviewed_recovery;
    end if;
    if v_reviewed_recovery then return new; end if;
  end if;
  if v_old = 'BLOCKED' and v_new in ('FAILED','CANCELED') then return new; end if;

  raise exception 'ILLEGAL_PAYOUT_STATUS_TRANSITION:%->%', v_old, v_new;
end;
$$;

drop trigger if exists payout_forward_status_guard on public.payouts;
create trigger payout_forward_status_guard
before update on public.payouts
for each row execute function public.guard_payout_forward_status();
revoke all on function public.guard_payout_forward_status() from public, anon, authenticated, service_role;

create or replace function public.apply_stripe_transfer_event_to_payout(
  p_payout_id text,
  p_event_type text,
  p_transfer_id text,
  p_destination text,
  p_amount integer,
  p_currency text,
  p_event jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payout public.payouts%rowtype;
  v_next_status public.payout_status;
begin
  if p_event_type not in ('transfer.created','transfer.reversed')
     or nullif(btrim(coalesce(p_transfer_id,'')), '') is null
     or nullif(btrim(coalesce(p_destination,'')), '') is null
     or p_amount is null or p_amount <= 0
     or nullif(btrim(coalesce(p_currency,'')), '') is null then
    raise exception 'PAYOUT_TRANSFER_EVENT_INVALID';
  end if;
  select * into v_payout from public.payouts where id::text = p_payout_id for update;
  if v_payout.id is null then raise exception 'PAYOUT_NOT_FOUND'; end if;
  if v_payout.provider::text <> 'STRIPE'
     or v_payout.provider_destination_id is distinct from p_destination
     or v_payout.amount is distinct from p_amount
     or upper(v_payout.currency::text) is distinct from upper(p_currency)
     or (v_payout.provider_payout_id is not null and v_payout.provider_payout_id <> p_transfer_id) then
    return jsonb_build_object('outcome','IDENTITY_MISMATCH','payout',to_jsonb(v_payout));
  end if;

  if p_event_type = 'transfer.created' and v_payout.status::text in ('PAID','REVERSED') then
    update public.payouts set
      provider_response = jsonb_build_object('latest_transfer_event', p_event),
      processed_at = now()
    where id = v_payout.id returning * into v_payout;
    return jsonb_build_object('outcome','STALE_TERMINAL_IGNORED','payout',to_jsonb(v_payout));
  end if;

  v_next_status := case when p_event_type = 'transfer.reversed'
    then 'REVERSED'::public.payout_status else 'PROCESSING'::public.payout_status end;
  if p_event_type = 'transfer.reversed' then
    perform set_config('drape.payout_transfer_reversal', 'evidenced', true);
  end if;
  update public.payouts set
    status = v_next_status,
    provider_payout_id = coalesce(provider_payout_id, p_transfer_id),
    provider_transfer_status = case when p_event_type='transfer.created'
      then 'AVAILABLE_IN_PROVIDER_BALANCE' else 'REVERSED' end,
    bank_settlement_status = case when p_event_type='transfer.created'
      then 'PENDING' else 'FAILED' end,
    provider_response = jsonb_build_object('latest_transfer_event', p_event),
    processed_at = now(),
    failed_at = case when p_event_type='transfer.reversed' then now() else failed_at end,
    bank_settlement_failed_at = case when p_event_type='transfer.reversed' then now() else bank_settlement_failed_at end,
    bank_settlement_failure_code = case when p_event_type='transfer.reversed'
      then 'PROVIDER_TRANSFER_REVERSED' else bank_settlement_failure_code end,
    blocked_reason = case when p_event_type='transfer.reversed'
      then 'PROVIDER_TRANSFER_REVERSED' else blocked_reason end
  where id = v_payout.id returning * into v_payout;
  perform set_config('drape.payout_transfer_reversal', '', true);
  return jsonb_build_object('outcome','APPLIED','payout',to_jsonb(v_payout));
exception when others then
  perform set_config('drape.payout_transfer_reversal', '', true);
  raise;
end;
$$;

revoke all on function public.apply_stripe_transfer_event_to_payout(text,text,text,text,integer,text,jsonb)
from public, anon, authenticated;
grant execute on function public.apply_stripe_transfer_event_to_payout(text,text,text,text,integer,text,jsonb)
to service_role;

