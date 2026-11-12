-- Dev-only reconciliation of an already succeeded external Stripe TEST TIP refund.
-- No provider request is sent here. The provider proof is retrieved by the Edge
-- adapter immediately before this single-transaction finalization.
create function public.complete_dev_reviewed_tip_refund_reconciliation(
  p_request_id uuid, p_attempt_id uuid, p_provider_evidence jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_request public.money_desk_requests%rowtype;
  v_attempt public.money_desk_execution_attempts%rowtype;
  v_tip public.order_tips%rowtype;
  v_payment public.order_payments%rowtype;
  v_claim public.tip_money_operation_claims%rowtype;
  v_old_request public.money_desk_requests%rowtype;
  v_issue public.ops_issues%rowtype;
  v_capture public.commercial_ledger_transactions%rowtype;
  v_journal public.commercial_ledger_transactions%rowtype;
  v_entries jsonb;
  v_journal_id uuid;
  v_journal_count integer;
  v_capture_count integer;
  v_approvers integer;
  v_auth_approvers integer;
  v_refund_id text;
  v_result jsonb;
begin
  if public.current_ops_environment() <> 'DEVELOPMENT' then
    raise exception 'TIP_RECOVERY_DEV_ONLY';
  end if;
  select * into v_request from public.money_desk_requests where id=p_request_id for update;
  select * into v_attempt from public.money_desk_execution_attempts where id=p_attempt_id for update;
  if v_request.id is null or v_attempt.id is null or v_attempt.request_id<>v_request.id
     or v_request.action_type<>'OTHER_REVIEWED'
     or v_request.target_type<>'TIP_REFUND_RECONCILIATION'
     or v_request.required_approval_count<>2 or v_request.approval_count<>2
     or v_request.requester_assurance_source is distinct from 'SUPABASE_MFA_LOCAL'
     or v_request.requester_principal_id is null
     or v_request.requester_auth_user_id is null
     or v_request.approved_at is null then
    raise exception 'TIP_RECOVERY_REVIEW_MISMATCH';
  end if;
  v_refund_id := v_request.action_payload->>'providerRefundId';
  if v_refund_id is null or v_refund_id !~ '^re_[A-Za-z0-9]+$'
     or p_provider_evidence->>'status' is distinct from 'succeeded'
     or p_provider_evidence->>'refund_id' is distinct from v_refund_id
     or p_provider_evidence->>'observed_at' is null
     or (p_provider_evidence->>'observed_at')::timestamptz
       not between now()-interval '2 minutes' and now()+interval '15 seconds' then
    raise exception 'TIP_RECOVERY_PROVIDER_PROOF_MISMATCH';
  end if;
  select * into v_issue from public.ops_issues
    where dedupe_key='stripe-tip-refund-review:'||v_refund_id for update;
  if v_issue.id is not null and (
       v_issue.issue_type<>'SYSTEM_ALERT' or v_issue.source<>'stripe-webhook'
       or v_issue.status not in ('OPEN','RESOLVED')
     ) then
    raise exception 'TIP_RECOVERY_CASE_MISMATCH';
  end if;
  select * into v_tip from public.order_tips
    where id::text=v_request.target_id for update;
  if v_tip.id is null or v_tip.order_id<>v_request.order_id
     or v_tip.amount<>v_request.amount or v_tip.currency<>v_request.currency then
    raise exception 'TIP_RECOVERY_TARGET_MISMATCH';
  end if;
  select * into v_payment from public.order_payments where id=v_tip.payment_id for update;
  select * into v_claim from public.tip_money_operation_claims
    where id=(v_request.action_payload->>'refundClaimId')::uuid
      and tip_id=v_tip.id and operation_kind='REFUND' for update;
  if v_payment.id is null or v_claim.id is null
     or v_payment.phase<>'TIP' or v_payment.provider<>'STRIPE'
     or v_payment.order_id<>v_tip.order_id or v_payment.amount<>v_tip.amount
     or v_payment.currency<>v_tip.currency or v_payment.provider_payment_id
       is distinct from v_request.action_payload->>'paymentIntentId'
     or v_request.action_payload->>'paymentId' is distinct from v_payment.id::text
     or v_request.action_payload->>'tipId' is distinct from v_tip.id::text
     or p_provider_evidence->>'payment_intent' is distinct from v_payment.provider_payment_id
     or (p_provider_evidence->>'amount')::integer is distinct from v_tip.amount then
    raise exception 'TIP_RECOVERY_PAYMENT_OR_CLAIM_MISMATCH';
  end if;

  select count(*) into v_journal_count from public.commercial_ledger_transactions
    where payment_id=v_payment.id and transaction_kind='REFUND'
      and purpose='TIP' and provider_reference=v_refund_id;
  if v_journal_count>1 then raise exception 'TIP_RECOVERY_JOURNAL_AMBIGUOUS'; end if;
  select * into v_journal from public.commercial_ledger_transactions
    where payment_id=v_payment.id and transaction_kind='REFUND'
      and purpose='TIP' and provider_reference=v_refund_id;
  if v_request.status='SUCCEEDED' and v_attempt.status='SUCCEEDED'
     and v_tip.status='REFUNDED' and v_payment.status='REFUNDED'
     and v_payment.refunded_amount=v_tip.amount and v_claim.status='SUCCEEDED'
     and v_claim.money_desk_request_id=v_request.id
     and v_claim.provider_operation_id=v_refund_id and v_journal_count=1
     and v_journal.order_id=v_tip.order_id and v_journal.original_amount=v_tip.amount
     and v_journal.original_currency=v_tip.currency
     and exists (select 1 from public.order_payment_provider_refunds r
       where r.payment_id=v_payment.id and r.provider='STRIPE'
         and r.provider_refund_id=v_refund_id and r.amount=v_tip.amount
         and r.status='CONFIRMED')
     and (select count(*) from public.order_payment_provider_refunds
       where payment_id=v_payment.id)=1 then
    return jsonb_build_object('ok',true,'duplicate',true,
      'journalId',v_journal.id,'providerReference',v_refund_id);
  end if;
  if v_request.status<>'EXECUTING' or v_attempt.status<>'PROCESSING'
     or v_tip.status<>'HELD' or v_payment.status<>'SUCCEEDED'
     or v_payment.refunded_amount<>0 or v_claim.status<>'RESERVED'
     or v_claim.refund_funding_mode<>'UNPAID_TIP'
     or v_claim.provider_operation_id is not null or v_journal_count<>0
     or v_request.action_payload->>'previousRequestId' is distinct from v_claim.money_desk_request_id::text
     or exists (select 1 from public.order_payment_provider_refunds
       where payment_id=v_payment.id)
     or exists (select 1 from public.payouts
       where source_payment_id=v_payment.id and payout_purpose='TIP') then
    raise exception 'TIP_RECOVERY_STATE_CHANGED';
  end if;
  select * into v_old_request from public.money_desk_requests
    where id=v_claim.money_desk_request_id;
  if v_old_request.id is null or v_old_request.status<>'FAILED'
     or v_old_request.action_type<>'CUSTOMER_REFUND'
     or v_old_request.target_type<>'ORDER_TIP'
     or v_old_request.target_id<>v_tip.id::text then
    raise exception 'TIP_RECOVERY_HISTORICAL_REVIEW_MISMATCH';
  end if;
  select count(distinct approver_principal_id), count(distinct approver_auth_user_id)
  into v_approvers,v_auth_approvers
  from public.money_desk_decisions where request_id=v_request.id
    and decision='APPROVE' and approver_role in ('FINANCE','ADMIN')
    and approver_assurance_source='SUPABASE_MFA_LOCAL' and approver_aal='aal2'
    and approver_mfa_at is not null
    and approver_principal_id is distinct from v_request.requester_principal_id
    and approver_auth_user_id is distinct from v_request.requester_auth_user_id;
  if v_approvers<>2 or v_auth_approvers<>2 then
    raise exception 'TIP_RECOVERY_INDEPENDENT_APPROVALS_REQUIRED';
  end if;

  select count(*) into v_capture_count from public.commercial_ledger_transactions
    where payment_id=v_payment.id and transaction_kind='CAPTURE' and purpose='TIP';
  if v_capture_count<>1 then raise exception 'TIP_RECOVERY_CAPTURE_JOURNAL_MISMATCH'; end if;
  select * into v_capture from public.commercial_ledger_transactions
    where payment_id=v_payment.id and transaction_kind='CAPTURE' and purpose='TIP';
  if v_capture.id is null or v_capture.original_amount<>v_tip.amount
     or v_capture.original_currency<>v_tip.currency
     or (select count(*) from public.commercial_ledger_entries where transaction_id=v_capture.id)<>2
     or not exists (select 1 from public.commercial_ledger_entries
       where transaction_id=v_capture.id and account_code='TIP_LIABILITY'
         and account_scope=v_tip.order_id
         and direction='CREDIT' and amount=v_tip.amount and currency=v_tip.currency)
     or not exists (select 1 from public.commercial_ledger_entries
       where transaction_id=v_capture.id and account_code='PROVIDER_CLEARING'
         and account_scope='STRIPE'
         and direction='DEBIT' and amount=v_tip.amount and currency=v_tip.currency) then
    raise exception 'TIP_RECOVERY_CAPTURE_JOURNAL_MISMATCH';
  end if;
  select jsonb_agg(jsonb_build_object('accountCode',e.account_code,
    'accountScope',e.account_scope,
    'direction',case when e.direction='DEBIT' then 'CREDIT' else 'DEBIT' end,
    'amount',e.amount,'currency',e.currency) order by e.id) into v_entries
  from public.commercial_ledger_entries e where e.transaction_id=v_capture.id;

  update public.tip_money_operation_claims
    set money_desk_request_id=v_request.id, updated_at=now() where id=v_claim.id;
  perform public.record_confirmed_order_payment_refund(
    v_payment.id,v_refund_id,v_tip.amount,p_provider_evidence);
  perform public.record_tip_money_operation_outcome(
    v_claim.id,'SUCCEEDED','STRIPE',v_refund_id,p_provider_evidence);
  select public.post_commercial_ledger_transaction(
    p_idempotency_key=>'tip-refund-reconciliation:'||v_payment.id::text||':'||v_refund_id,
    p_transaction_kind=>'REFUND',p_purpose=>'TIP',p_order_id=>v_tip.order_id,
    p_payment_id=>v_payment.id,p_policy_version=>v_capture.policy_version,
    p_pricing_version=>v_capture.pricing_version,p_correlation_id=>v_request.correlation_id,
    p_provider_reference=>v_refund_id,p_entries=>v_entries,
    p_metadata=>jsonb_build_object('reviewed_request_id',v_request.id,
      'historical_request_id',v_old_request.id,'provider_evidence',p_provider_evidence),
    p_reversal_of_transaction_id=>v_capture.id,p_actor_role=>'OPS',
    p_original_currency=>v_tip.currency,p_original_amount=>v_tip.amount,
    p_settlement_currency=>v_tip.currency,p_settlement_amount=>v_tip.amount
  ) into v_journal_id;
  v_result := public.finalize_claimed_tip_refund(v_tip.id,v_claim.id,v_refund_id);
  if v_journal_id is null or v_result->>'outcome'<>'FINALIZED' then
    raise exception 'TIP_RECOVERY_FINALIZATION_FAILED';
  end if;
  if v_issue.id is not null then
    if v_issue.order_id is distinct from v_tip.order_id then
      raise exception 'TIP_RECOVERY_CASE_MISMATCH';
    end if;
    if v_issue.status='OPEN' then
      update public.ops_issues set status='RESOLVED', canonical_status='RESOLVED',
        resolved_at=now(), last_seen_at=now() where id=v_issue.id;
      insert into public.ops_case_events (
        issue_id,event_type,visibility,sensitivity,actor_label,from_status,to_status,
        summary,payload,idempotency_key,correlation_id,occurred_at
      ) values (
        v_issue.id,'STATE_TRANSITION','INTERNAL',v_issue.sensitivity,
        v_attempt.executor_role,v_issue.canonical_status,'RESOLVED',
        'Reviewed TIP refund reconciliation completed.',
        jsonb_build_object('moneyDeskRequestId',v_request.id,'refundId',v_refund_id),
        'tip-refund-reconciled:'||v_request.id::text||':'||v_issue.id::text,
        v_request.correlation_id,now()
      );
    end if;
  end if;
  perform public.complete_money_desk_execution(
    v_attempt.id,'SUCCEEDED',v_refund_id,null,null);
  return jsonb_build_object('ok',true,'duplicate',false,
    'journalId',v_journal_id,'providerReference',v_refund_id);
end;
$$;

revoke all on function public.complete_dev_reviewed_tip_refund_reconciliation(uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.complete_dev_reviewed_tip_refund_reconciliation(uuid,uuid,jsonb)
  to service_role;
