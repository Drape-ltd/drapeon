-- A historical FAILED provider refund can have a REFUND journal left by the old
-- webhook path. Only an independently approved Money Desk execution with fresh
-- provider evidence may reverse that exact journal. This function never calls a
-- payment provider, retries a refund, or changes the order/dispute hold.
create function public.complete_reviewed_failed_refund_journal_recovery(
  p_request_id uuid,
  p_attempt_id uuid,
  p_provider_evidence jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_request public.money_desk_requests%rowtype;
  v_attempt public.money_desk_execution_attempts%rowtype;
  v_refund public.order_payment_provider_refunds%rowtype;
  v_payment public.order_payments%rowtype;
  v_journal public.commercial_ledger_transactions%rowtype;
  v_reversal public.commercial_ledger_transactions%rowtype;
  v_issue public.ops_issues%rowtype;
  v_entries jsonb;
  v_approval_count integer;
  v_journal_count integer;
  v_reversal_count integer;
  v_reversal_id uuid;
begin
  if p_request_id is null or p_attempt_id is null
     or jsonb_typeof(p_provider_evidence) <> 'object'
     or p_provider_evidence->>'status' <> 'failed'
     or p_provider_evidence->>'refund_id' is null
     or p_provider_evidence->>'payment_intent' is null
     or p_provider_evidence->>'amount' is null
     or p_provider_evidence->>'observed_at' is null then
    raise exception 'FAILED_REFUND_PROVIDER_EVIDENCE_INVALID';
  end if;
  if (p_provider_evidence->>'observed_at')::timestamptz < now() - interval '5 minutes'
     or (p_provider_evidence->>'observed_at')::timestamptz > now() + interval '1 minute' then
    raise exception 'FAILED_REFUND_PROVIDER_EVIDENCE_STALE';
  end if;

  select * into v_request from public.money_desk_requests
  where id = p_request_id for update;
  select * into v_attempt from public.money_desk_execution_attempts
  where id = p_attempt_id for update;
  if v_request.id is null or v_attempt.id is null
     or v_attempt.request_id is distinct from v_request.id
     or v_request.action_type <> 'OTHER_REVIEWED'
     or v_request.target_type <> 'FAILED_REFUND_JOURNAL'
     or v_request.required_approval_count <> 2
     or v_request.approval_count < 2
     or v_request.approved_at is null then
    raise exception 'FAILED_REFUND_REVIEW_MISMATCH';
  end if;
  select count(distinct d.approver_subject) into v_approval_count
  from public.money_desk_decisions d
  where d.request_id = v_request.id and d.decision = 'APPROVE'
    and d.approver_subject is distinct from v_request.requester_subject;
  if v_approval_count < 2 then
    raise exception 'FAILED_REFUND_APPROVALS_MISSING';
  end if;

  select * into v_refund from public.order_payment_provider_refunds
  where id::text = v_request.target_id for update;
  if v_refund.id is null or v_refund.status <> 'FAILED'
     or v_refund.provider <> 'STRIPE'
     or v_request.action_payload->>'providerRefundId' is distinct from v_refund.provider_refund_id
     or p_provider_evidence->>'refund_id' is distinct from v_refund.provider_refund_id
     or (p_provider_evidence->>'amount') !~ '^[0-9]+$'
     or (p_provider_evidence->>'amount')::bigint <> v_refund.amount then
    raise exception 'FAILED_REFUND_TARGET_MISMATCH';
  end if;
  select * into v_payment from public.order_payments
  where id = v_refund.payment_id for update;
  if v_payment.id is null or v_payment.provider <> 'STRIPE'
     or v_payment.status not in ('SUCCEEDED', 'PARTIAL_REFUND')
     or v_request.order_id is distinct from v_payment.order_id
     or v_request.amount is distinct from v_refund.amount
     or v_request.currency is distinct from v_payment.currency
     or v_request.action_payload->>'paymentId' is distinct from v_payment.id::text
     or p_provider_evidence->>'payment_intent' is distinct from v_payment.provider_payment_id then
    raise exception 'FAILED_REFUND_PAYMENT_MISMATCH';
  end if;
  select * into v_issue from public.ops_issues
  where id::text = v_request.action_payload->>'opsIssueId' for update;
  if v_issue.id is null
     or v_request.case_id is distinct from v_issue.id
     or v_issue.issue_type <> 'REFUND_FAILED'
     or v_issue.order_id is distinct from v_payment.order_id
     or v_issue.dedupe_key not like 'refund-ledger-missing:' || v_payment.id::text || ':%'
     or v_issue.status not in ('OPEN', 'RESOLVED') then
    raise exception 'FAILED_REFUND_CASE_MISMATCH';
  end if;

  select count(*), (array_agg(id))[1] into v_journal_count, v_journal.id
  from public.commercial_ledger_transactions
  where payment_id = v_payment.id and transaction_kind = 'REFUND'
    and provider_reference = v_refund.provider_refund_id;
  if v_journal_count <> 1 then
    raise exception 'FAILED_REFUND_JOURNAL_AMBIGUOUS';
  end if;
  select * into v_journal from public.commercial_ledger_transactions
  where id = v_journal.id for update;
  if v_journal.order_id is distinct from v_payment.order_id
     or v_journal.original_amount <> v_refund.amount
     or v_journal.settlement_amount <> v_refund.amount
     or v_journal.original_currency <> v_payment.currency
     or v_journal.settlement_currency <> v_payment.currency then
    raise exception 'FAILED_REFUND_JOURNAL_MISMATCH';
  end if;

  select count(*), (array_agg(id))[1] into v_reversal_count, v_reversal.id
  from public.commercial_ledger_transactions
  where reversal_of_transaction_id = v_journal.id;
  if v_reversal_count > 1 then
    raise exception 'FAILED_REFUND_REVERSAL_AMBIGUOUS';
  end if;
  if v_reversal_count = 1 then
    select * into v_reversal from public.commercial_ledger_transactions
    where id = v_reversal.id;
    if v_request.status = 'SUCCEEDED' and v_attempt.status = 'SUCCEEDED'
       and v_issue.status = 'RESOLVED'
       and v_reversal.transaction_kind = 'REVERSAL'
       and v_reversal.idempotency_key = 'refund-failure-reversal:' || v_refund.provider_refund_id
       and v_reversal.payment_id = v_payment.id
       and v_reversal.provider_reference = v_refund.provider_refund_id
       and v_reversal.original_amount = v_journal.original_amount
       and v_reversal.settlement_amount = v_journal.settlement_amount then
      return jsonb_build_object('ok', true, 'duplicate', true,
        'reversalId', v_reversal.id, 'providerReference', v_refund.provider_refund_id);
    end if;
    raise exception 'FAILED_REFUND_REVERSAL_CONFLICT';
  end if;
  if v_request.status <> 'EXECUTING' or v_attempt.status <> 'PROCESSING' then
    raise exception 'FAILED_REFUND_REVIEW_NOT_EXECUTING';
  end if;
  if v_issue.status <> 'OPEN' then
    raise exception 'FAILED_REFUND_CASE_NOT_OPEN';
  end if;

  select jsonb_agg(jsonb_build_object(
      'accountCode', e.account_code,
      'accountScope', e.account_scope,
      'direction', case when e.direction = 'DEBIT' then 'CREDIT' else 'DEBIT' end,
      'amount', e.amount,
      'currency', e.currency
    ) order by e.id) into v_entries
  from public.commercial_ledger_entries e where e.transaction_id = v_journal.id;
  if v_entries is null or jsonb_array_length(v_entries) < 2 then
    raise exception 'FAILED_REFUND_JOURNAL_ENTRIES_MISSING';
  end if;
  select public.post_commercial_ledger_transaction(
    p_idempotency_key => 'refund-failure-reversal:' || v_refund.provider_refund_id,
    p_transaction_kind => 'REVERSAL',
    p_purpose => v_journal.purpose,
    p_order_id => v_journal.order_id,
    p_payment_id => v_payment.id,
    p_policy_version => v_journal.policy_version,
    p_pricing_version => v_journal.pricing_version,
    p_correlation_id => v_request.correlation_id,
    p_provider_reference => v_refund.provider_refund_id,
    p_entries => v_entries,
    p_metadata => jsonb_build_object('failed_refund_journal_id', v_journal.id,
      'money_desk_request_id', v_request.id, 'money_desk_attempt_id', v_attempt.id,
      'provider_evidence', p_provider_evidence),
    p_reversal_of_transaction_id => v_journal.id,
    p_actor_role => 'OPS',
    p_original_currency => v_journal.original_currency,
    p_original_amount => v_journal.original_amount,
    p_settlement_currency => v_journal.settlement_currency,
    p_settlement_amount => v_journal.settlement_amount,
    p_fx_rate => v_journal.fx_rate,
    p_provider_fee_amount => 0
  ) into v_reversal_id;
  if v_reversal_id is null then raise exception 'FAILED_REFUND_REVERSAL_MISSING'; end if;
  update public.ops_issues set status='RESOLVED', canonical_status='RESOLVED',
    resolved_at=now(), last_seen_at=now()
  where id=v_issue.id;
  insert into public.ops_case_events (
    issue_id,event_type,visibility,sensitivity,actor_label,from_status,to_status,
    summary,payload,idempotency_key,correlation_id,occurred_at
  ) values (
    v_issue.id,'STATE_TRANSITION','INTERNAL',v_issue.sensitivity,
    v_attempt.executor_role,v_issue.canonical_status,'RESOLVED',
    'False refund ledger state reversed after verified provider failure.',
    jsonb_build_object('moneyDeskRequestId',v_request.id,'reversalId',v_reversal_id),
    'failed-refund-journal-recovered:' || v_request.id::text || ':' || v_issue.id::text,
    v_request.correlation_id,now()
  ) on conflict (issue_id,idempotency_key) do nothing;
  insert into public.ops_audit_logs (
    issue_id,action_taken,performed_by,performed_role,reason,before_state,after_state
  ) values (
    v_issue.id,'FAILED_REFUND_JOURNAL_RECOVERED',v_attempt.executor_email,
    v_attempt.executor_role,v_request.reason,
    jsonb_build_object('failedRefundId',v_refund.id,'falseRefundJournalId',v_journal.id),
    jsonb_build_object('moneyDeskRequestId',v_request.id,'reversalId',v_reversal_id,
      'providerRefundStatus','failed')
  );
  perform public.complete_money_desk_execution(
    p_attempt_id, 'SUCCEEDED', v_refund.provider_refund_id, null, null
  );
  return jsonb_build_object('ok', true, 'duplicate', false,
    'reversalId', v_reversal_id, 'providerReference', v_refund.provider_refund_id);
end;
$$;

revoke all on function public.complete_reviewed_failed_refund_journal_recovery(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_reviewed_failed_refund_journal_recovery(uuid,uuid,jsonb)
  to service_role;
