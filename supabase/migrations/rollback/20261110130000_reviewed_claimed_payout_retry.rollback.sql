-- DRAFT: exact live Dev function bodies captured read-only on 2026-11-10.
-- Roll back Edge callers before this file. Do not run after any reviewed retry
-- has been authorized or sent; a forward repair must preserve provider history.

do $guard$
begin
  if exists (select 1 from public.payout_claim_retry_authorizations)
    or exists (select 1 from public.payout_provider_operations where reviewed_retry_id is not null) then
    raise exception 'Reviewed claimed-payout retry has authoritative history; use a forward repair';
  end if;
end;
$guard$;

-- public.guard_payout_forward_status; live pg_get_functiondef captured byte-for-byte.
CREATE OR REPLACE FUNCTION public.guard_payout_forward_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- public.prepare_replacement_attempt_on_start; live pg_get_functiondef captured byte-for-byte.
CREATE OR REPLACE FUNCTION public.prepare_replacement_attempt_on_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_attempt_number integer;
begin
  if new.operation_number not between 2 and 3 or old.status<>'RESERVED'
    or new.status<>'PROVIDER_UNKNOWN' then return new; end if;
  -- The trusted start RPC already holds the claim row. Another attempt under
  -- that claim cannot take this number concurrently; the existing unique
  -- (claim_id,attempt_number) is the final database backstop.
  select coalesce(max(attempt_number),0)+1 into v_attempt_number
    from public.payout_attempts where claim_id=new.claim_id;
  insert into public.payout_attempts (
    claim_id,claim_operation_id,attempt_number,status,provider_evidence
  ) values (
    new.claim_id,new.id,v_attempt_number,'PREPARED',
    jsonb_build_object('stage','REVIEWED_REPLACEMENT_PREPARED',
      'operation_id',new.id,'operation_number',new.operation_number,
      'provider_key',new.provider_idempotency_key)
  );
  return new;
end $function$;

-- public.require_matching_payout_correction_operation; live pg_get_functiondef captured byte-for-byte.
CREATE OR REPLACE FUNCTION public.require_matching_payout_correction_operation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_number integer;
begin
  if new.operation_number=1 then return new; end if;
  select operation_number into v_number
    from public.payout_destination_corrections
    where id=new.reviewed_correction_id;
  if v_number is distinct from new.operation_number then
    raise exception 'Reviewed correction is for a different provider operation';
  end if;
  return new;
end $function$;

-- public.start_payout_attempt; live pg_get_functiondef captured byte-for-byte.
CREATE OR REPLACE FUNCTION public.start_payout_attempt(p_claim_id uuid, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_operation public.payout_provider_operations%rowtype;
  v_attempt public.payout_attempts%rowtype;
  v_number integer;
  v_initial_status text;
begin
  if p_mode not in ('PROVIDER_CALL','RECONCILE') then
    raise exception 'Unknown payout attempt mode';
  end if;
  select * into v_claim from public.payout_claims where id=p_claim_id for update;
  if v_claim.id is null then raise exception 'Payout claim not found'; end if;

  select * into v_operation
    from public.payout_provider_operations
    where claim_id=p_claim_id
    order by operation_number desc
    limit 1 for update;

  -- Claims created before operation tracking keep their exact original key and
  -- transfer reference. A legacy terminal failure is not reconstructed because
  -- it lacks the provider-confirmed funds-return evidence needed for correction.
  if v_operation.id is null and v_claim.status in ('TRANSFERRED','WITHDRAWN')
    and nullif(btrim(v_claim.provider_transfer_id),'') is null then
    raise exception 'Completed payout claim has no provider transfer reference; route it to Ops';
  end if;
  if v_operation.id is null and v_claim.status <> 'FAILED_RECONCILED'
      and v_claim.status <> 'BLOCKED' then
    v_initial_status := case v_claim.status
      when 'PROVIDER_UNKNOWN' then 'PROVIDER_UNKNOWN'
      when 'PROVIDER_PENDING' then 'PROVIDER_PENDING'
      when 'TRANSFERRED' then 'TRANSFERRED'
      when 'WITHDRAWN' then 'WITHDRAWN'
      else 'RESERVED'
    end;
    insert into public.payout_provider_operations (
      claim_id, operation_number, provider, provider_destination_id,
      currency, amount, provider_idempotency_key, status, provider_transfer_id
    ) values (
      v_claim.id, 1, v_claim.provider, v_claim.provider_destination_id,
      v_claim.currency, v_claim.amount, v_claim.provider_idempotency_key,
      v_initial_status, v_claim.provider_transfer_id
    ) returning * into v_operation;
  end if;

  if v_operation.id is not null and (
    v_operation.provider is distinct from v_claim.provider
    or v_operation.currency is distinct from v_claim.currency
    or v_operation.amount is distinct from v_claim.amount
    or (v_operation.operation_number=1 and (
      v_operation.provider_destination_id is distinct from v_claim.provider_destination_id
      or v_operation.provider_idempotency_key is distinct from v_claim.provider_idempotency_key
      or v_operation.reviewed_correction_id is not null
      or v_operation.money_desk_request_id is not null
    ))
    or (v_operation.operation_number>1 and (
      v_operation.provider_idempotency_key is distinct from
        v_claim.business_key||':op:'||v_operation.operation_number::text
      or v_operation.reviewed_correction_id is null
      or v_operation.money_desk_request_id is null
    ))
  ) then
    raise exception 'Payout provider operation conflicts with the immutable claim or reviewed correction';
  end if;

  if v_claim.status='BLOCKED' or v_operation.id is null then
    return jsonb_build_object('action','BLOCKED','claim_id',v_claim.id);
  end if;

  if v_claim.status in ('TRANSFERRED','WITHDRAWN') then
    if v_operation.status not in ('TRANSFERRED','WITHDRAWN')
      or nullif(btrim(v_operation.provider_transfer_id),'') is null then
      raise exception 'Confirmed payout claim has no matching successful provider operation';
    end if;
    return jsonb_build_object(
      'action','DONE','claim_id',v_claim.id,
      'claim_operation_id',v_operation.id,
      'operation_number',v_operation.operation_number,
      'provider_idempotency_key',v_operation.provider_idempotency_key,
      'provider_transfer_id',v_operation.provider_transfer_id,
      'provider',v_operation.provider,
      'provider_destination_id',v_operation.provider_destination_id,
      'currency',v_operation.currency,
      'amount',v_operation.amount,
      'reviewed_correction_id',v_operation.reviewed_correction_id,
      'money_desk_request_id',v_operation.money_desk_request_id
    );
  end if;

  if v_claim.status='FAILED_RECONCILED' then
    return jsonb_build_object('action','BLOCKED','claim_id',v_claim.id);
  end if;

  if (v_claim.status='RESERVED' and p_mode<>'PROVIDER_CALL')
    or (v_claim.status in ('PROVIDER_UNKNOWN','PROVIDER_PENDING') and p_mode<>'RECONCILE') then
    return jsonb_build_object('action','RECONCILE_FIRST','claim_id',v_claim.id,
      'status',v_claim.status);
  end if;

  if v_operation.status in ('TRANSFERRED','WITHDRAWN') then
    return jsonb_build_object(
      'action','DONE','claim_id',v_claim.id,
      'claim_operation_id',v_operation.id,
      'operation_number',v_operation.operation_number,
      'provider_idempotency_key',v_operation.provider_idempotency_key,
      'provider_transfer_id',v_operation.provider_transfer_id,
      'provider',v_operation.provider,
      'provider_destination_id',v_operation.provider_destination_id,
      'currency',v_operation.currency,
      'amount',v_operation.amount,
      'reviewed_correction_id',v_operation.reviewed_correction_id,
      'money_desk_request_id',v_operation.money_desk_request_id
    );
  end if;
  if v_operation.status='FAILED_RETURNED' or v_operation.status='LATE_SUCCEEDED' then
    return jsonb_build_object('action','BLOCKED','claim_id',v_claim.id);
  end if;
  if p_mode='PROVIDER_CALL' and v_operation.status<>'RESERVED' then
    return jsonb_build_object('action','RECONCILE_FIRST','claim_id',v_claim.id,
      'status',v_operation.status);
  end if;
  if p_mode='RECONCILE' and v_operation.status not in ('PROVIDER_UNKNOWN','PROVIDER_PENDING') then
    return jsonb_build_object('action','RECONCILE_FIRST','claim_id',v_claim.id,
      'status',v_operation.status);
  end if;

  select coalesce(max(attempt_number),0)+1 into v_number
    from public.payout_attempts where claim_id=p_claim_id;
  insert into public.payout_attempts(
    claim_id,attempt_number,claim_operation_id,status,provider_evidence
  ) values (
    p_claim_id,v_number,v_operation.id,'PREPARED',
    jsonb_build_object('mode',p_mode,'operation_number',v_operation.operation_number)
  ) returning * into v_attempt;

  if p_mode='PROVIDER_CALL' then
    update public.payout_provider_operations
      set status='PROVIDER_UNKNOWN'
      where id=v_operation.id and status='RESERVED';
    update public.payout_claims set status='PROVIDER_UNKNOWN',transfer_status='UNKNOWN'
      where id=p_claim_id;
  end if;

  return jsonb_build_object(
    'action',p_mode,'claim_id',v_claim.id,'attempt_id',v_attempt.id,
    'claim_operation_id',v_operation.id,'operation_number',v_operation.operation_number,
    'provider_idempotency_key',v_operation.provider_idempotency_key,
    'provider_transfer_id',v_operation.provider_transfer_id,
    'provider',v_operation.provider,
    'provider_destination_id',v_operation.provider_destination_id,
    'currency',v_operation.currency,'amount',v_operation.amount,
    'reviewed_correction_id',v_operation.reviewed_correction_id,
    'money_desk_request_id',v_operation.money_desk_request_id
  );
end;
$function$;

-- public.validate_payout_provider_operation_reservation; live pg_get_functiondef captured byte-for-byte.
CREATE OR REPLACE FUNCTION public.validate_payout_provider_operation_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_previous public.payout_provider_operations%rowtype;
  v_correction public.payout_destination_corrections%rowtype;
  v_request public.money_desk_requests%rowtype;
  v_approvers integer;
begin
  select * into v_claim from public.payout_claims where id=new.claim_id for update;
  if not found then raise exception 'Payout earning claim is missing'; end if;
  if row(new.provider,new.currency,new.amount)
    is distinct from row(v_claim.provider,v_claim.currency,v_claim.amount) then
    raise exception 'Replacement cannot change payout provider, currency or earning';
  end if;
  if new.operation_number=1 then
    if new.provider_destination_id is distinct from v_claim.provider_destination_id
      or new.provider_idempotency_key is distinct from v_claim.provider_idempotency_key then
      raise exception 'Initial provider operation must match the accepted claim';
    end if;
    return new;
  end if;
  if new.provider_idempotency_key is distinct from
    v_claim.business_key||':op:'||new.operation_number::text then
    raise exception 'Replacement must use its fixed operation key';
  end if;
  select * into v_previous from public.payout_provider_operations
    where claim_id=new.claim_id and operation_number=new.operation_number-1 for update;
  if not found or v_previous.status<>'FAILED_RETURNED'
    or v_previous.final_failure_reference is null
    or v_previous.funds_return_reference is null
    or v_previous.funds_return_confirmed_at is null then
    raise exception 'Previous transfer is not finally returned to available balance';
  end if;
  if new.provider_destination_id is not distinct from v_previous.provider_destination_id then
    raise exception 'Reviewed replacement destination must differ from the failed one';
  end if;
  select * into v_correction from public.payout_destination_corrections
    where id=new.reviewed_correction_id;
  if not found or v_correction.money_desk_request_id is distinct from new.money_desk_request_id
    or v_correction.order_id::text is distinct from v_claim.order_id
    or v_correction.tailor_profile_id::text is distinct from v_claim.tailor_profile_id
    or v_correction.provider::text is distinct from v_claim.provider then
    raise exception 'Reviewed correction does not match this earning claim';
  end if;
  select * into v_request from public.money_desk_requests
    where id=new.money_desk_request_id;
  if not found or v_request.action_type<>'PAYOUT_DESTINATION_CHANGE'
    or v_request.target_type<>'ORDER_PAYOUT_FAILURE'
    or v_request.status<>'SUCCEEDED'
    or v_request.required_approval_count<>2 or v_request.approval_count<>2 then
    raise exception 'Two-person destination correction approval is not terminal';
  end if;
  select count(distinct lower(approver_email)) into v_approvers
    from public.money_desk_decisions
    where request_id=v_request.id and decision='APPROVE'
      and lower(approver_email)<>lower(v_request.requester_email);
  if v_approvers<>2 then
    raise exception 'Two distinct approvers other than the requester are required';
  end if;
  return new;
end $function$;

-- public.verify_provider_operation_destination_fingerprints; live pg_get_functiondef captured byte-for-byte.
CREATE OR REPLACE FUNCTION public.verify_provider_operation_destination_fingerprints()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_correction public.payout_destination_corrections%rowtype;
  v_previous public.payout_provider_operations%rowtype;
  v_previous_fingerprint text;
  v_replacement_fingerprint text;
begin
  if new.operation_number=1 then return new; end if;
  select * into v_claim from public.payout_claims where id=new.claim_id;
  select * into v_correction from public.payout_destination_corrections
    where id=new.reviewed_correction_id;
  select * into v_previous from public.payout_provider_operations
    where claim_id=new.claim_id and operation_number=new.operation_number-1;
  if v_claim.id is null or v_claim.payout_id is null
    or v_correction.id is null or v_previous.id is null then
    raise exception 'Reviewed payout and destination evidence is missing';
  end if;
  if v_correction.failed_payout_id::text is distinct from v_claim.payout_id then
    raise exception 'Reviewed correction belongs to a different payout';
  end if;
  v_previous_fingerprint := encode(digest(new.provider||':'||v_previous.provider_destination_id,'sha256'),'hex');
  v_replacement_fingerprint := encode(digest(new.provider||':'||new.provider_destination_id,'sha256'),'hex');
  if v_correction.previous_destination_fingerprint is distinct from v_previous_fingerprint
    or v_correction.replacement_destination_fingerprint is distinct from v_replacement_fingerprint then
    raise exception 'Provider operation destination differs from the reviewed recovery';
  end if;
  return new;
end $function$;

-- public.verify_replacement_attempt_identity; live pg_get_functiondef captured byte-for-byte.
CREATE OR REPLACE FUNCTION public.verify_replacement_attempt_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

-- Exact live Dev operation identity trigger before this migration.
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
$function$;

-- Restore the original operation identity rule after the captured function
-- bodies. The preflight above guarantees no reviewed-retry rows would be lost.
drop function public.load_reviewed_claimed_tranche_retry(uuid,uuid,text,text,text);
drop function public.close_unstarted_reviewed_claimed_retry(uuid);
drop function public.apply_reviewed_claimed_payout_retry(uuid,text,text);
alter table public.payout_provider_operations
  drop constraint payout_provider_operations_check;
alter table public.payout_provider_operations
  drop column reviewed_retry_id;
alter table public.payout_provider_operations
  add constraint payout_provider_operations_check check (
    (operation_number = 1 and reviewed_correction_id is null and money_desk_request_id is null)
    or (operation_number > 1 and reviewed_correction_id is not null and money_desk_request_id is not null)
  );
drop table public.payout_claim_retry_authorizations;
drop function public.validate_payout_claim_retry_authorization();
drop function public.prevent_payout_claim_retry_authorization_rewrite();
