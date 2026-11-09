-- Restore the exact pre-change Dev pg_get_functiondef. Roll back dependent Edge/web code first.
CREATE OR REPLACE FUNCTION public.finalize_ops_order_cancellation_refund(p_money_desk_request_id uuid, p_dispute_id uuid, p_provider_reference text DEFAULT NULL::text, p_actor_email text DEFAULT NULL::text, p_actor_role text DEFAULT 'SYSTEM'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request public.money_desk_requests%rowtype;
  v_order public.orders%rowtype;
  v_dispute public.disputes%rowtype;
  v_review_issue public.ops_issues%rowtype;
  v_review jsonb;
  v_special_note jsonb;
  v_review_requested_at text;
  v_attempt public.money_desk_execution_attempts%rowtype;
  v_claim_count integer;
  v_incomplete_count integer;
  v_approval_count integer;
  v_note text;
  v_issue record;
  v_resolved_at timestamptz := now();
begin
  select * into v_request
  from public.money_desk_requests
  where id = p_money_desk_request_id
  for update;

  if v_request.id is null then raise exception 'Money Desk cancellation request was not found.'; end if;
  if v_request.action_type <> 'CUSTOMER_REFUND' or v_request.target_type <> 'ORDER_CANCELLATION' then
    raise exception 'Money Desk request is not an order cancellation refund.';
  end if;
  if v_request.order_id is null or v_request.order_id <> v_request.target_id then
    raise exception 'Cancellation request is missing its immutable order link.';
  end if;
  if (p_dispute_id is null) = (nullif(v_request.action_payload->>'reviewIssueId', '') is null) then
    raise exception 'Cancellation request must name exactly one review or dispute source.';
  end if;
  if p_dispute_id is not null and
     v_request.action_payload->>'disputeId' is distinct from p_dispute_id::text then
    raise exception 'Cancellation dispute does not match the approved request.';
  end if;
  if v_request.status = 'FAILED' then
    return jsonb_build_object(
      'requestId', v_request.id,
      'orderId', v_request.order_id,
      'status', 'FAILED',
      'remainingClaimCount', null,
      'duplicate', true
    );
  end if;
  if v_request.status not in ('EXECUTING', 'SUCCEEDED') then
    raise exception 'Cancellation request is not executing.';
  end if;
  if v_request.status = 'EXECUTING' then
    if v_request.approved_at is null or
       v_request.approval_count < v_request.required_approval_count then
      raise exception 'Cancellation refund lacks required Money Desk approvals.';
    end if;
    select count(distinct lower(d.approver_email)) into v_approval_count
    from public.money_desk_decisions d
    where d.request_id = v_request.id and d.decision = 'APPROVE'
      and lower(d.approver_email) <> lower(v_request.requester_email);
    if v_approval_count < v_request.required_approval_count then
      raise exception 'Cancellation refund lacks independent approvers.';
    end if;
  end if;

  select * into v_order from public.orders where id::text = v_request.order_id for update;
  if v_order.id is null then raise exception 'Cancellation order was not found.'; end if;

  if p_dispute_id is not null then
    select * into v_dispute from public.disputes where id::text = p_dispute_id::text for update;
    if v_dispute.id is null or v_dispute.order_id::text <> v_order.id::text then
      raise exception 'Cancellation dispute was not found for this order.';
    end if;
  else
    if v_request.action_payload->>'disputeId' is not null then
      raise exception 'Cancellation review request also names a dispute.';
    end if;
    v_review_requested_at := nullif(v_request.action_payload->>'reviewRequestedAt', '');
    if v_review_requested_at is null then
      raise exception 'Cancellation review request is missing its immutable opening time.';
    end if;
    select * into v_review_issue from public.ops_issues
      where id::text = v_request.action_payload->>'reviewIssueId' for update;
    if v_review_issue.id is null or v_review_issue.order_id::text <> v_order.id::text or
       v_review_issue.issue_type <> 'ORDER_REVIEW' or
       v_review_issue.metadata->>'review_type' <> 'CANCELLATION' or
       (v_review_issue.status not in ('OPEN', 'IN_REVIEW', 'ESCALATED') and
        not (v_request.status = 'SUCCEEDED' and v_review_issue.status = 'RESOLVED')) then
      raise exception 'Cancellation review case does not match the approved request.';
    end if;
    v_special_note := v_order.special_note::jsonb;
    v_review := v_special_note->'cancellationReview';
    if v_review->>'requestedAt' is distinct from v_review_requested_at or
       (v_review->>'status' <> 'OPEN' and
        not (v_request.status = 'SUCCEEDED' and v_review->>'status' = 'RESOLVED')) then
      raise exception 'Cancellation review changed after approval.';
    end if;
  end if;

  select count(*) into v_claim_count
  from jsonb_array_elements(coalesce(v_request.action_payload->'paymentClaims', '[]'::jsonb));
  if v_claim_count = 0 then raise exception 'Cancellation request has no approved payment claims.'; end if;

  select count(*) into v_incomplete_count
  from jsonb_array_elements(v_request.action_payload->'paymentClaims') claim
  left join public.order_payments payment
    on payment.id::text = claim->>'paymentId'
   and payment.order_id::text = v_order.id::text
  where payment.id is null
     or payment.status::text <> 'REFUNDED'
     or coalesce(payment.refunded_amount, 0) < payment.amount;

  if v_incomplete_count > 0 then
    return jsonb_build_object(
      'requestId', v_request.id,
      'orderId', v_order.id,
      'status', 'PROCESSING',
      'remainingClaimCount', v_incomplete_count,
      'duplicate', false
    );
  end if;

  v_note := 'Drapeon approved cancellation and every captured, unreleased payment reached a recorded refund. '
    || coalesce(nullif(trim(v_request.action_payload->>'note'), ''), v_request.reason);

  perform public.finalize_order_terminal(
    v_order.id::uuid,
    'REFUNDED'::text,
    null::text,
    upper(coalesce(nullif(trim(p_actor_role), ''), 'SYSTEM')),
    'ops.order_cancellation_refund_completed'::text,
    v_note,
    jsonb_build_object(
      'money_desk_request_id', v_request.id,
      'refunded_payment_count', v_claim_count,
      'amount', v_request.amount,
      'currency', v_request.currency,
      'provider_reference', nullif(trim(coalesce(p_provider_reference, '')), '')
    ),
    case when v_order.stage::text = 'REFUNDED' then null else array['IN_DISPUTE']::text[] end,
    case when p_dispute_id is null then
      jsonb_set(v_special_note, '{cancellationReview}',
        v_review || jsonb_build_object('status', 'RESOLVED', 'resolvedAt', v_resolved_at), true)::text
    else null end,
    p_dispute_id is null,
    true,
    true,
    false
  );

  if p_dispute_id is null then
    null;
  elsif v_dispute.status::text in ('OPEN', 'UNDER_REVIEW') then
    update public.disputes set
      status = 'RESOLVED_REFUNDED',
      resolution = v_note,
      resolved_at = v_resolved_at,
      resolved_by = null,
      updated_at = v_resolved_at
    where id = v_dispute.id;
  elsif v_dispute.status::text <> 'RESOLVED_REFUNDED' then
    raise exception 'Cancellation dispute reached a conflicting terminal state.';
  end if;

  update public.order_material_advances set
    status = 'CANCELLED',
    release_status = 'BLOCKED',
    reconciliation_status = 'RESOLVED',
    reconciliation_outcome = 'UNUSED_VALUE',
    reconciled_at = coalesce(reconciled_at, v_resolved_at),
    reconciliation_resolved_at = coalesce(reconciliation_resolved_at, v_resolved_at),
    reconciliation_resolution = 'CUSTOMER_REFUNDED'
  where id::text in (
    select claim->>'materialAdvanceId'
    from jsonb_array_elements(v_request.action_payload->'paymentClaims') claim
    where nullif(claim->>'materialAdvanceId', '') is not null
  );

  for v_issue in
    select id, status, assigned_to, resolved_at
    from public.ops_issues
    where order_id::text = v_order.id::text
      and issue_type in ('PRODUCTION_STALL', 'PAYOUT_BLOCKED', 'ORDER_REVIEW', 'REFUND_FAILED')
      and (p_dispute_id is not null or issue_type <> 'ORDER_REVIEW' or id = v_review_issue.id)
      and status <> 'RESOLVED'
    for update
  loop
    update public.ops_issues set
      status = 'RESOLVED',
      assigned_to = coalesce(nullif(trim(coalesce(p_actor_email, '')), ''), assigned_to),
      resolved_at = v_resolved_at,
      last_seen_at = v_resolved_at
    where id = v_issue.id;

    insert into public.ops_audit_logs (
      issue_id, action_taken, performed_by, performed_role, reason, before_state, after_state
    ) values (
      v_issue.id,
      'ORDER_CANCELLATION_REFUND_COMPLETED',
      nullif(trim(coalesce(p_actor_email, '')), ''),
      upper(coalesce(nullif(trim(p_actor_role), ''), 'SYSTEM')),
      v_note,
      jsonb_build_object('status', v_issue.status, 'assigned_to', v_issue.assigned_to, 'resolved_at', v_issue.resolved_at),
      jsonb_build_object('status', 'RESOLVED', 'resolved_at', v_resolved_at, 'money_desk_request_id', v_request.id)
    );
  end loop;

  if v_request.status = 'EXECUTING' then
    select * into v_attempt
    from public.money_desk_execution_attempts
    where request_id = v_request.id and status = 'PROCESSING'
    order by started_at desc
    limit 1
    for update;
    if v_attempt.id is null then raise exception 'Cancellation execution attempt was not found.'; end if;

    perform public.complete_money_desk_execution(
      v_attempt.id,
      'SUCCEEDED',
      nullif(trim(coalesce(p_provider_reference, '')), ''),
      null,
      null
    );
  end if;

  return jsonb_build_object(
    'requestId', v_request.id,
    'orderId', v_order.id,
    'disputeId', v_dispute.id,
    'reviewIssueId', v_review_issue.id,
    'status', 'SUCCEEDED',
    'remainingClaimCount', 0,
    'duplicate', v_request.status = 'SUCCEEDED'
  );
end;
$function$;


revoke all on function public.finalize_ops_order_cancellation_refund(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.finalize_ops_order_cancellation_refund(uuid,uuid,text,text,text) to service_role;
