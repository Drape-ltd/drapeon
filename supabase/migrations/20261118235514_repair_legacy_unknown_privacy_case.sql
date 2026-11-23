-- One-time forward repair for OPS-481417B5, the single QA data-access case
-- written before request writers failed closed on an unknown environment.
-- Approved in Drape-ltd/drapeon#239. This block is intentionally inert outside
-- Production and after the row has been repaired.

do $$
declare
  v_target_case_number constant text := 'OPS-481417B5';
  v_idempotency_key constant text := 'migration:20261118235514:repair-legacy-unknown-privacy-case';
  v_actor constant text := 'migration:20261118235514';
  v_reason constant text := 'Approved forward repair for the legacy QA privacy case; Drape-ltd/drapeon#239.';
  v_now timestamptz := now();
  v_issue public.ops_issues%rowtype;
  v_issue_id uuid;
  v_receipt public.ops_action_receipts%rowtype;
  v_before_state jsonb;
begin
  if coalesce(public.current_ops_environment(), 'UNKNOWN') <> 'PRODUCTION' then
    return;
  end if;

  select * into v_issue
  from public.ops_issues
  where case_number = v_target_case_number
  for update;

  -- A missing, already-repaired, closed, or otherwise mismatched row is not
  -- evidence that another case should be touched. Leave it unchanged.
  if v_issue.id is null
    or v_issue.issue_type <> 'DATA_ACCESS_REQUEST'
    or v_issue.source <> 'request-data-access'
    or v_issue.environment <> 'UNKNOWN'
    or v_issue.provenance <> 'UNKNOWN'
    or v_issue.canonical_status in ('RESOLVED', 'CLOSED', 'CANCELLED')
    or exists (
      select 1 from public.ops_action_receipts
      where issue_id = v_issue.id and idempotency_key = v_idempotency_key
    )
  then
    return;
  end if;

  v_issue_id := v_issue.id;

  v_before_state := jsonb_build_object(
    'environment', v_issue.environment,
    'provenance', v_issue.provenance,
    'queueKey', v_issue.queue_key,
    'canonicalStatus', v_issue.canonical_status,
    'recordVersion', v_issue.record_version
  );

  insert into public.ops_action_receipts (
    issue_id, action_key, idempotency_key, actor_principal_id,
    expected_record_version, outcome, human_status, correlation_id,
    side_effects, blockers, next_action, completed_at
  ) values (
    v_issue.id, 'REPAIR_LEGACY_UNKNOWN_PRIVACY_CASE', v_idempotency_key, null,
    v_issue.record_version, 'SUCCEEDED',
    'Legacy QA privacy case restored to the Production privacy queue.', gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('caseNumber', v_issue.case_number, 'environment', 'PRODUCTION', 'provenance', 'QA')),
    '[]'::jsonb, 'Close this QA request through the normal privacy workflow.', v_now
  ) returning * into v_receipt;

  update public.ops_issues
  set environment = 'PRODUCTION',
      provenance = 'QA',
      queue_key = 'privacy-deletion',
      owning_team = coalesce(owning_team, 'customer_success'),
      recommended_action = 'QA request restored after the legacy environment-label defect. Close through the normal privacy workflow.',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'legacyUnknownPrivacyRepairAt', v_now,
        'legacyUnknownPrivacyRepairBy', v_actor,
        'legacyUnknownPrivacyRepairReason', v_reason,
        'legacyUnknownPrivacyRepairApproval', 'Drape-ltd/drapeon#239'
      )
  where id = v_issue.id
    and record_version = v_issue.record_version;

  if not found then
    raise exception 'Legacy QA privacy case changed during migration.' using errcode = '40001';
  end if;

  select * into v_issue from public.ops_issues where id = v_issue_id;

  insert into public.ops_case_events (
    issue_id, event_type, visibility, sensitivity, actor_principal_id,
    actor_label, from_status, to_status, summary, payload,
    idempotency_key, correlation_id, occurred_at
  ) values (
    v_issue.id, 'AUDIT_SECURITY', 'INTERNAL', 'HIGHLY_RESTRICTED', null,
    v_actor, v_before_state ->> 'canonicalStatus', v_issue.canonical_status,
    'Migration repaired the legacy UNKNOWN environment label on the QA privacy case.',
    jsonb_build_object(
      'before', v_before_state,
      'after', jsonb_build_object('environment', v_issue.environment, 'provenance', v_issue.provenance, 'queueKey', v_issue.queue_key, 'recordVersion', v_issue.record_version),
      'reason', v_reason,
      'approval', 'Drape-ltd/drapeon#239'
    ),
    'legacy-unknown-privacy-repair:' || v_receipt.id::text, v_receipt.correlation_id, v_now
  );

  insert into public.ops_audit_logs (
    issue_id, action_taken, performed_by, performed_role, reason,
    before_state, after_state, created_at
  ) values (
    v_issue.id, 'REPAIR_LEGACY_UNKNOWN_PRIVACY_CASE', v_actor, 'MIGRATION', v_reason,
    v_before_state,
    jsonb_build_object('environment', v_issue.environment, 'provenance', v_issue.provenance, 'queueKey', v_issue.queue_key, 'recordVersion', v_issue.record_version),
    v_now
  );

  update public.ops_action_receipts
  set resulting_record_version = v_issue.record_version
  where id = v_receipt.id;
end;
$$;
