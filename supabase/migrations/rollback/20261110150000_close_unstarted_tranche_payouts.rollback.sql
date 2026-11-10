CREATE OR REPLACE FUNCTION public.prevent_payout_provider_operation_identity_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
         new.reviewed_retry_id, new.money_desk_request_id)
    is distinct from
     row(old.claim_id, old.operation_number, old.provider, old.provider_destination_id,
         old.currency, old.amount, old.provider_idempotency_key, old.reviewed_correction_id,
         old.reviewed_retry_id, old.money_desk_request_id)
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
$function$;

DROP FUNCTION IF EXISTS public.close_unstarted_settlement_tranche_payout(uuid, text);
