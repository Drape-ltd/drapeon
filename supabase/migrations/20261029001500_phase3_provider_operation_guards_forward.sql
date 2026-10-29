-- Forward-only restoration of operation claim guards missing from Production's
-- pre-Phase-2 migration history. Definitions derive from the final Dev catalog and adapt native UUID
-- order/payment IDs through text bridges; each function's origin was located on the isolated Phase 1 branch.
-- Money Edge deployment remains blocked until the bindings migration passes.

-- public.freeze_claim_on_late_provider_operation_success
CREATE OR REPLACE FUNCTION public.freeze_claim_on_late_provider_operation_success()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.status='FAILED_RETURNED' and new.status='LATE_SUCCEEDED' then
    update public.payout_claims
      set status='BLOCKED', last_provider_checked_at=now()
      where id=new.claim_id and status<>'BLOCKED';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.freeze_claim_on_late_provider_operation_success() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.freeze_claim_on_late_provider_operation_success() TO service_role;

-- public.guard_claimed_replacement_against_refund
CREATE OR REPLACE FUNCTION public.guard_claimed_replacement_against_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_payout public.payouts%rowtype;
  v_payment public.order_payments%rowtype;
begin
  if new.operation_number=1 then return new; end if;
  select * into v_claim from public.payout_claims where id=new.claim_id;
  if v_claim.id is null or v_claim.source_kind<>'ORDER_EARNING'
    or v_claim.payout_id is null then
    raise exception 'Replacement funding route is not proven for this claim';
  end if;
  select * into v_payout from public.payouts where id::text=v_claim.payout_id;
  if v_payout.id is null or v_payout.source_payment_id is null then
    raise exception 'Replacement lacks its exact source payment';
  end if;

  -- Refund claim reservation takes order, payment, then claim. Do the same
  -- here before the existing operation validator locks the claim.
  perform 1 from public.orders where id_text=v_claim.order_id for update;
  if not found then raise exception 'Replacement order is missing'; end if;
  select * into v_payment from public.order_payments
    where id=v_payout.source_payment_id for update;
  select * into v_claim from public.payout_claims
    where id=new.claim_id for update;
  if v_payment.id is null or v_claim.id is null
    or v_claim.status<>'BLOCKED'
    or v_payout.order_id::text is distinct from v_claim.order_id
    or v_payout.tailor_profile_id::text is distinct from v_claim.tailor_profile_id
    or v_payment.order_id::text is distinct from v_claim.order_id
    or v_payment.phase<>'INITIAL_ORDER'
    or v_payment.provider::text is distinct from v_claim.provider
    or v_payment.currency is distinct from v_claim.currency
    or v_payment.status<>'SUCCEEDED'
    or coalesce(v_payment.refunded_amount,0)>0 then
    raise exception 'Replacement source is not an unreimbursed accepted earning';
  end if;
  if exists (select 1 from public.order_payment_refund_claims r
      where r.payment_id=v_payment.id and r.status<>'FAILED_RECONCILED')
    or exists (select 1 from public.disputes d
      where d.order_id::text=v_claim.order_id and d.status in ('OPEN','UNDER_REVIEW'))
    or exists (select 1 from public.provider_disputes d
      where d.order_id=v_claim.order_id and d.money_movement_blocked=true) then
    raise exception 'Replacement must wait for refund or dispute review';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.guard_claimed_replacement_against_refund() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_claimed_replacement_against_refund() TO service_role;

-- public.guard_reviewed_adjustment_provider_operation
CREATE OR REPLACE FUNCTION public.guard_reviewed_adjustment_provider_operation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_claim public.payout_claims%rowtype;
  v_adjustment public.commercial_adjustments%rowtype;
  v_operation public.adjustment_money_operation_claims%rowtype;
  v_request public.money_desk_requests%rowtype;
  v_approvers integer;
begin
  select * into v_claim from public.payout_claims where id=new.claim_id;
  if v_claim.id is null or v_claim.source_kind<>'TAILOR_ADJUSTMENT' then
    return new;
  end if;
  if new.operation_number<>1 then return new; end if;
  if v_claim.source_id !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'Adjustment provider operation lacks a valid source';
  end if;
  -- Match the payout/refund reservation's order-first lock order.
  perform 1 from public.orders where id_text=v_claim.order_id for update;
  select * into v_adjustment from public.commercial_adjustments
    where id=v_claim.source_id::uuid for update;
  select * into v_claim from public.payout_claims where id=new.claim_id for update;
  if v_adjustment.id is null or v_claim.source_id<>v_adjustment.id::text
    or v_claim.order_id<>v_adjustment.order_id
    or v_claim.status<>'RESERVED'
    or v_claim.provider_transfer_id is not null
    or new.provider_idempotency_key<>v_claim.provider_idempotency_key
    or new.provider<>v_claim.provider
    or new.provider_destination_id<>v_claim.provider_destination_id
    or new.amount<>v_claim.amount or new.currency<>v_claim.currency then
    raise exception 'Adjustment provider operation differs from its reserved earning';
  end if;
  select * into v_operation from public.adjustment_money_operation_claims
    where payout_claim_id=v_claim.id and operation_kind='PAYOUT' for update;
  if v_operation.id is null or v_operation.adjustment_id<>v_adjustment.id
    or v_operation.source_payment_id is distinct from v_adjustment.payment_id
    or v_operation.request_key<>'adjustment:'||v_adjustment.id::text||':payout'
    or v_operation.amount<>v_claim.amount
    or v_operation.currency<>v_claim.currency
    or v_operation.status<>'RESERVED'
    or not exists (select 1 from public.commercial_ledger_transactions t
      where t.id=v_operation.capture_transaction_id
        and t.payment_id=v_adjustment.payment_id
        and t.order_id=v_adjustment.order_id
        and t.transaction_kind='CAPTURE' and t.purpose='ADJUSTMENT') then
    raise exception 'Adjustment provider operation needs its captured Money Desk reservation';
  end if;
  select * into v_request from public.money_desk_requests
    where id=v_operation.money_desk_request_id for update;
  if v_request.id is null or v_request.action_type<>'PAYOUT_RELEASE'
    or v_request.target_type<>'TAILOR_ADJUSTMENT'
    or v_request.target_id<>v_adjustment.id::text
    or v_request.order_id<>v_adjustment.order_id
    or v_request.amount is distinct from v_claim.amount
    or v_request.currency is distinct from v_claim.currency
    or v_request.status<>'EXECUTING'
    or v_request.approved_at is null
    or v_request.approval_count<>v_request.required_approval_count
    or not exists (select 1 from public.money_desk_execution_attempts e
      where e.request_id=v_request.id and e.status='PROCESSING') then
    raise exception 'Adjustment payout needs an executing Money Desk approval';
  end if;
  select count(distinct lower(d.approver_email)) into v_approvers
    from public.money_desk_decisions d
    where d.request_id=v_request.id and d.decision='APPROVE'
      and lower(d.approver_email)<>lower(v_request.requester_email);
  if v_approvers<v_request.required_approval_count then
    raise exception 'Adjustment payout approvals are incomplete';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.guard_reviewed_adjustment_provider_operation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_reviewed_adjustment_provider_operation() TO service_role;

-- public.prepare_replacement_attempt_on_start
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

REVOKE ALL ON FUNCTION public.prepare_replacement_attempt_on_start() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_replacement_attempt_on_start() TO service_role;

-- public.prevent_provider_operation_evidence_rewrite
CREATE OR REPLACE FUNCTION public.prevent_provider_operation_evidence_rewrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if (old.final_failure_reference is not null
      and new.final_failure_reference is distinct from old.final_failure_reference)
    or (old.funds_return_reference is not null
      and new.funds_return_reference is distinct from old.funds_return_reference)
    or (old.funds_return_confirmed_at is not null
      and new.funds_return_confirmed_at is distinct from old.funds_return_confirmed_at)
    or (old.provider_transfer_id is not null
      and new.provider_transfer_id is distinct from old.provider_transfer_id) then
    raise exception 'Recorded provider operation evidence cannot be rewritten';
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.prevent_provider_operation_evidence_rewrite() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prevent_provider_operation_evidence_rewrite() TO service_role;

-- public.require_matching_payout_correction_operation
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

REVOKE ALL ON FUNCTION public.require_matching_payout_correction_operation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.require_matching_payout_correction_operation() TO service_role;

-- public.validate_payout_provider_operation_reservation
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

REVOKE ALL ON FUNCTION public.validate_payout_provider_operation_reservation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_payout_provider_operation_reservation() TO service_role;

-- public.verify_provider_operation_destination_fingerprints
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

REVOKE ALL ON FUNCTION public.verify_provider_operation_destination_fingerprints() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_provider_operation_destination_fingerprints() TO service_role;
