-- One-time, audited forward repair for the single Production QA data-access
-- case that was written before request writers failed closed on an unknown
-- environment. This function deliberately cannot repair arbitrary cases.

create or replace function public.repair_legacy_unknown_privacy_case(
  p_expected_record_version bigint,
  p_idempotency_key text,
  p_actor_principal_id uuid,
  p_actor_label text,
  p_environment text,
  p_correlation_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_issue_id constant uuid := 'c3d227f8-128a-4650-93ff-04a19e66ad02';
  v_environment text := upper(trim(coalesce(p_environment, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_now timestamptz := now();
  v_principal public.ops_workforce_principals%rowtype;
  v_issue public.ops_issues%rowtype;
  v_receipt public.ops_action_receipts%rowtype;
  v_before_state jsonb;
begin
  if p_actor_principal_id is null or p_correlation_id is null then
    raise exception 'A named workforce principal and correlation ID are required.' using errcode = '22023';
  end if;
  if p_expected_record_version is null or p_expected_record_version < 1 then
    raise exception 'Expected case version is required.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) < 16 or length(p_idempotency_key) > 180 then
    raise exception 'A bounded idempotency key is required.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_actor_label, ''))) < 3 or length(p_actor_label) > 180 then
    raise exception 'A named workforce actor is required.' using errcode = '22023';
  end if;
  if length(v_reason) < 12 or length(v_reason) > 1000 then
    raise exception 'A repair reason between 12 and 1000 characters is required.' using errcode = '22023';
  end if;
  if v_environment <> 'PRODUCTION' or public.current_ops_environment() <> 'PRODUCTION' then
    raise exception 'This forward repair is Production-only.' using errcode = '42501';
  end if;

  select * into v_principal
  from public.ops_workforce_principals
  where id = p_actor_principal_id
  for share;

  if v_principal.id is null
    or v_principal.status <> 'ACTIVE'
    or not ('admin' = any(v_principal.roles))
    or not ('production' = any(v_principal.permitted_environments))
  then
    raise exception 'An active Production admin is required for this forward repair.' using errcode = '42501';
  end if;

  select * into v_issue
  from public.ops_issues
  where id = v_target_issue_id
  for update;

  if v_issue.id is null
    or v_issue.issue_type <> 'DATA_ACCESS_REQUEST'
    or v_issue.source <> 'request-data-access'
    or v_issue.environment <> 'UNKNOWN'
    or v_issue.provenance <> 'UNKNOWN'
    or v_issue.canonical_status in ('RESOLVED', 'CLOSED', 'CANCELLED')
  then
    raise exception 'The legacy privacy case is not eligible for this repair.' using errcode = '42501';
  end if;

  select * into v_receipt
  from public.ops_action_receipts
  where issue_id = v_target_issue_id
    and idempotency_key = trim(p_idempotency_key);
  if v_receipt.id is not null then
    return jsonb_build_object(
      'duplicate', true,
      'receiptId', v_receipt.id,
      'receiptOutcome', v_receipt.outcome,
      'caseNumber', v_issue.case_number,
      'caseStatus', v_issue.canonical_status,
      'recordVersion', v_issue.record_version,
      'correlationId', v_receipt.correlation_id
    );
  end if;

  if v_issue.record_version <> p_expected_record_version then
    raise exception 'CASE_VERSION_CONFLICT:%', v_issue.record_version using errcode = '40001';
  end if;

  v_before_state := jsonb_build_object(
    'environment', v_issue.environment,
    'provenance', v_issue.provenance,
    'queueKey', v_issue.queue_key,
    'recordVersion', v_issue.record_version
  );

  insert into public.ops_action_receipts (
    issue_id, action_key, idempotency_key, actor_principal_id,
    expected_record_version, outcome, human_status, correlation_id,
    side_effects, blockers, next_action, completed_at
  ) values (
    v_target_issue_id, 'REPAIR_LEGACY_UNKNOWN_PRIVACY_CASE', trim(p_idempotency_key),
    p_actor_principal_id, p_expected_record_version, 'SUCCEEDED',
    'Legacy QA privacy case restored to the Production privacy queue.', p_correlation_id,
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
        'legacyUnknownPrivacyRepairBy', trim(p_actor_label),
        'legacyUnknownPrivacyRepairReason', v_reason
      )
  where id = v_target_issue_id
    and record_version = p_expected_record_version;

  if not found then
    raise exception 'Case changed while the repair was being applied.' using errcode = '40001';
  end if;

  select * into v_issue from public.ops_issues where id = v_target_issue_id;

  insert into public.ops_case_events (
    issue_id, event_type, visibility, sensitivity, actor_principal_id,
    actor_label, from_status, to_status, summary, payload,
    idempotency_key, correlation_id, occurred_at
  ) values (
    v_target_issue_id, 'AUDIT_SECURITY', 'INTERNAL', 'HIGHLY_RESTRICTED',
    p_actor_principal_id, trim(p_actor_label), v_issue.canonical_status, v_issue.canonical_status,
    'A Production admin repaired the legacy UNKNOWN environment label on the QA privacy case.',
    jsonb_build_object(
      'before', jsonb_build_object('environment', 'UNKNOWN', 'provenance', 'UNKNOWN'),
      'after', jsonb_build_object('environment', 'PRODUCTION', 'provenance', 'QA', 'queueKey', 'privacy-deletion'),
      'reason', v_reason
    ),
    'legacy-unknown-privacy-repair:' || v_receipt.id::text, p_correlation_id, v_now
  );

  insert into public.ops_audit_logs (
    issue_id, action_taken, performed_by, performed_role, reason,
    before_state, after_state, created_at
  ) values (
    v_target_issue_id, 'REPAIR_LEGACY_UNKNOWN_PRIVACY_CASE', trim(p_actor_label),
    array_to_string(v_principal.roles, ','), v_reason,
    v_before_state,
    jsonb_build_object('environment', v_issue.environment, 'provenance', v_issue.provenance, 'queueKey', v_issue.queue_key, 'recordVersion', v_issue.record_version),
    v_now
  );

  update public.ops_action_receipts
  set resulting_record_version = v_issue.record_version
  where id = v_receipt.id
  returning * into v_receipt;

  return jsonb_build_object(
    'duplicate', false,
    'receiptId', v_receipt.id,
    'receiptOutcome', v_receipt.outcome,
    'caseNumber', v_issue.case_number,
    'caseStatus', v_issue.canonical_status,
    'recordVersion', v_issue.record_version,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.repair_legacy_unknown_privacy_case(bigint,text,uuid,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.repair_legacy_unknown_privacy_case(bigint,text,uuid,text,text,uuid,text)
  to service_role;

comment on function public.repair_legacy_unknown_privacy_case(bigint,text,uuid,text,text,uuid,text) is
  'One-time Production-only, admin-only audited repair for OPS-481417B5; repairs no other case.';
