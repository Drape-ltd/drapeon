-- A reviewed retry remains under the original immutable refund claim. Each
-- provider request is a separately keyed attempt tied to its Money Desk review.
alter table public.order_payment_refund_attempts
  add column money_desk_request_id uuid
    references public.money_desk_requests(id) on delete restrict,
  add column reviewed_retry_of_attempt_id uuid
    references public.order_payment_refund_attempts(id) on delete restrict,
  add constraint order_payment_refund_attempts_review_pair_check
    check ((money_desk_request_id is null) = (reviewed_retry_of_attempt_id is null));

create unique index order_payment_refund_attempts_review_request_uidx
  on public.order_payment_refund_attempts(money_desk_request_id)
  where money_desk_request_id is not null;
create index order_payment_refund_attempts_reviewed_retry_idx
  on public.order_payment_refund_attempts(reviewed_retry_of_attempt_id)
  where reviewed_retry_of_attempt_id is not null;

create or replace function public.guard_order_payment_refund_attempt()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'RESERVED' or new.provider_refund_id is not null
      or nullif(btrim(new.provider_charge_id), '') is null
      or ((new.money_desk_request_id is null) <> (new.reviewed_retry_of_attempt_id is null)) then
      raise exception 'A new Bachs refund attempt must start reserved with a complete identity';
    end if;
    return new;
  end if;

  if new.refund_claim_id is distinct from old.refund_claim_id
    or new.attempt_number is distinct from old.attempt_number
    or new.provider_reference is distinct from old.provider_reference
    or new.idempotency_key is distinct from old.idempotency_key
    or new.provider_charge_id is distinct from old.provider_charge_id
    or new.money_desk_request_id is distinct from old.money_desk_request_id
    or new.reviewed_retry_of_attempt_id is distinct from old.reviewed_retry_of_attempt_id then
    raise exception 'Refund attempt identity is immutable';
  end if;
  if (old.status = 'SUCCEEDED' and new.status <> 'SUCCEEDED')
    or (old.status = 'FAILED_RECONCILED' and new.status not in ('FAILED_RECONCILED', 'SUCCEEDED'))
    or (old.status = 'PROVIDER_PENDING' and new.status not in ('PROVIDER_PENDING', 'SUCCEEDED', 'FAILED_RECONCILED', 'PROVIDER_UNKNOWN'))
    or (old.status = 'PROVIDER_UNKNOWN' and new.status not in ('PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED_RECONCILED'))
    or (old.status = 'RESERVED' and new.status not in ('RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED_RECONCILED')) then
    raise exception 'Refund attempt status transition is unsafe';
  end if;
  if old.provider_refund_id is not null and new.provider_refund_id is not null
    and old.provider_refund_id <> new.provider_refund_id then
    raise exception 'Refund attempt provider identity is immutable';
  end if;
  if new.status = 'SUCCEEDED' and nullif(btrim(new.provider_refund_id), '') is null then
    raise exception 'A successful refund attempt requires a provider refund ID';
  end if;
  return new;
end;
$$;

create function public.reserve_bachs_payment_refund_retry_attempt(
  p_claim_id uuid,
  p_failed_attempt_id uuid,
  p_money_desk_request_id uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_claim public.order_payment_refund_claims%rowtype;
  v_payment public.order_payments%rowtype;
  v_request public.money_desk_requests%rowtype;
  v_failed public.order_payment_refund_attempts%rowtype;
  v_attempt public.order_payment_refund_attempts%rowtype;
  v_active public.order_payment_refund_attempts%rowtype;
  v_number integer;
  v_approval_count integer;
begin
  if p_claim_id is null or p_failed_attempt_id is null or p_money_desk_request_id is null then
    return jsonb_build_object('outcome', 'INVALID_REQUEST');
  end if;

  select * into v_claim from public.order_payment_refund_claims
    where id = p_claim_id for update;
  if not found then return jsonb_build_object('outcome', 'CLAIM_NOT_FOUND'); end if;
  if v_claim.provider <> 'BACHS' or v_claim.status <> 'FAILED_RECONCILED' then
    return jsonb_build_object('outcome', 'CLAIM_NOT_TERMINALLY_FAILED');
  end if;

  select * into v_payment from public.order_payments where id = v_claim.payment_id;
  if not found or v_payment.provider <> 'BACHS'
    or v_payment.order_id is distinct from v_claim.order_id
    or v_payment.provider_payment_id is distinct from v_claim.provider_payment_id
    or v_payment.currency is distinct from v_claim.currency
    or nullif(btrim(v_payment.provider_charge_id), '') is null
    or v_payment.provider_charge_id not like 'ch_%' then
    return jsonb_build_object('outcome', 'PAYMENT_IDENTITY_MISMATCH');
  end if;

  select * into v_request from public.money_desk_requests
    where id = p_money_desk_request_id;
  if not found or v_request.action_type <> 'CUSTOMER_REFUND'
    or v_request.target_type <> 'BACHS_REFUND_RETRY'
    or v_request.target_id <> v_claim.id::text
    or v_request.order_id is distinct from v_claim.order_id
    or v_request.amount is distinct from v_claim.refund_amount
    or v_request.currency is distinct from v_claim.currency
    or v_request.status <> 'EXECUTING'
    or v_request.approved_at is null
    or v_request.approval_count < v_request.required_approval_count
    or v_request.action_payload ->> 'refundClaimId' is distinct from v_claim.id::text
    or v_request.action_payload ->> 'failedAttemptId' is distinct from p_failed_attempt_id::text
    or v_request.action_payload ->> 'paymentId' is distinct from v_claim.payment_id::text then
    return jsonb_build_object('outcome', 'REVIEW_NOT_APPROVED_OR_MISMATCHED');
  end if;

  select count(distinct d.approver_email)::integer into v_approval_count
    from public.money_desk_decisions d
    where d.request_id = v_request.id and d.decision = 'APPROVE'
      and lower(d.approver_email) <> lower(v_request.requester_email);
  if v_approval_count < v_request.required_approval_count then
    return jsonb_build_object('outcome', 'INSUFFICIENT_INDEPENDENT_APPROVALS');
  end if;

  select * into v_attempt from public.order_payment_refund_attempts
    where money_desk_request_id = p_money_desk_request_id;
  if found then
    if v_attempt.refund_claim_id <> v_claim.id
      or v_attempt.reviewed_retry_of_attempt_id <> p_failed_attempt_id
      or v_attempt.provider_charge_id <> v_payment.provider_charge_id then
      return jsonb_build_object('outcome', 'RETRY_REQUEST_ALREADY_BOUND');
    end if;
    return jsonb_build_object(
      'outcome', 'EXISTING', 'claim_id', v_claim.id, 'attempt_id', v_attempt.id,
      'attempt_number', v_attempt.attempt_number, 'status', v_attempt.status,
      'provider_reference', v_attempt.provider_reference,
      'idempotency_key', v_attempt.idempotency_key,
      'provider_refund_id', v_attempt.provider_refund_id,
      'provider_charge_id', v_attempt.provider_charge_id,
      'money_desk_request_id', v_attempt.money_desk_request_id,
      'reviewed_retry_of_attempt_id', v_attempt.reviewed_retry_of_attempt_id
    );
  end if;

  select * into v_failed from public.order_payment_refund_attempts
    where id = p_failed_attempt_id and refund_claim_id = v_claim.id for update;
  if not found or v_failed.status <> 'FAILED_RECONCILED'
    or v_failed.provider_charge_id <> v_payment.provider_charge_id
    -- Only a terminal failed Bachs refund object is retryable. A rejected
    -- create request (which has no refund ID/status evidence) needs a separate
    -- reconciliation path and must not be resubmitted as a refund retry.
    or nullif(btrim(v_failed.provider_refund_id), '') is null
    or v_failed.provider_evidence ->> 'status' is distinct from 'failed'
    or v_failed.provider_evidence ->> 'refund_id' is distinct from v_failed.provider_refund_id then
    return jsonb_build_object('outcome', 'FAILED_ATTEMPT_NOT_RECONCILED');
  end if;
  select * into v_attempt from public.order_payment_refund_attempts
    where refund_claim_id = v_claim.id order by attempt_number desc limit 1 for update;
  if not found or v_attempt.id <> v_failed.id then
    return jsonb_build_object('outcome', 'FAILED_ATTEMPT_NOT_LATEST');
  end if;

  select * into v_active from public.order_payment_refund_attempts
    where refund_claim_id = v_claim.id
      and status in ('RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING')
    order by attempt_number desc limit 1 for update;
  if found then return jsonb_build_object('outcome', 'ACTIVE_ATTEMPT_EXISTS'); end if;

  select coalesce(max(attempt_number), 0) + 1 into v_number
    from public.order_payment_refund_attempts where refund_claim_id = v_claim.id;
  insert into public.order_payment_refund_attempts (
    refund_claim_id, attempt_number, provider_reference, idempotency_key,
    provider_charge_id, money_desk_request_id, reviewed_retry_of_attempt_id
  ) values (
    v_claim.id, v_number,
    'refund_' || replace(v_claim.id::text, '-', '') || '_' || v_number::text,
    'drapeon-refund:' || replace(v_claim.id::text, '-', '') || ':' || v_number::text,
    v_payment.provider_charge_id, v_request.id, v_failed.id
  ) returning * into v_attempt;

  return jsonb_build_object(
    'outcome', 'RESERVED', 'claim_id', v_claim.id, 'attempt_id', v_attempt.id,
    'attempt_number', v_attempt.attempt_number, 'status', v_attempt.status,
    'provider_reference', v_attempt.provider_reference,
    'idempotency_key', v_attempt.idempotency_key,
    'provider_refund_id', v_attempt.provider_refund_id,
    'provider_charge_id', v_attempt.provider_charge_id,
    'money_desk_request_id', v_attempt.money_desk_request_id,
    'reviewed_retry_of_attempt_id', v_attempt.reviewed_retry_of_attempt_id
  );
end;
$$;

revoke all on function public.reserve_bachs_payment_refund_retry_attempt(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_bachs_payment_refund_retry_attempt(uuid, uuid, uuid)
  to service_role;
