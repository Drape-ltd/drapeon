-- Bound reminder production, not just Slack delivery. Preserve historical rows.
-- Three reminders per open/reopened lifecycle, one backup-team escalation,
-- then the existing daily digest remains the continuing visibility surface.
create or replace function public.enqueue_ops_slack_sla_reminders()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
set statement_timeout = '5s'
as $$
declare
  v_case record;
  v_count integer := 0;
  v_correlation uuid;
  v_receipt uuid;
  v_version bigint;
begin
  -- The scheduled job and manual recovery calls cannot overlap.
  if not pg_try_advisory_xact_lock(741903, 1) then return 0; end if;
  for v_case in
    select issue.*, policy.backup_team, cycle.started_at,
      reminders.sent, reminders.last_sent,
      'sla-reminder-cap:' || extract(epoch from cycle.started_at)::text as cycle_key
    from public.ops_issues issue
    cross join lateral (
      select greatest(issue.created_at, coalesce(max(reopened.at), issue.created_at)) as started_at
      from (
        select occurred_at as at from public.ops_case_events
        where issue_id = issue.id and event_type = 'REOPEN'
        union all
        select created_at from public.ops_audit_logs
        where issue_id = issue.id and action_taken = 'ISSUE_REOPENED'
      ) reopened
    ) cycle
    cross join lateral (
      select count(*)::integer as sent, max(created_at) as last_sent
      from (
        select created_at from public.ops_audit_logs
        where issue_id = issue.id and action_taken = 'SLA_REMINDER_DUE'
          and created_at >= cycle.started_at
        order by created_at desc limit 3
      ) recent
    ) reminders
    join lateral (
      select backup_team from public.ops_queue_policies
      where environment = issue.environment and queue_key = issue.queue_key
        and active and retired_at is null and effective_at <= now()
      order by (version = issue.sla_policy_version) desc, effective_at desc, updated_at desc
      limit 1
    ) policy on true
    where issue.environment = public.current_ops_environment()
      and issue.provenance <> 'UNKNOWN'
      and issue.canonical_status in ('NEW', 'TRIAGED', 'IN_PROGRESS', 'SCHEDULED_FOLLOW_UP',
        'WAITING_CUSTOMER', 'WAITING_COUNTERPARTY', 'WAITING_PROVIDER', 'BLOCKED', 'ESCALATED')
      and issue.sla_clock_paused_at is null
      and case when issue.first_responded_at is null then issue.first_response_due_at
        else issue.active_resolution_due_at end <= now()
      and not exists (
        select 1 from public.ops_action_receipts receipt
        where receipt.issue_id = issue.id
          and receipt.idempotency_key = 'sla-reminder-cap:' || extract(epoch from cycle.started_at)::text
      )
      and (reminders.last_sent is null or reminders.last_sent <= now() - case issue.severity
        when 'CRITICAL' then interval '1 hour'
        when 'HIGH' then interval '4 hours'
        when 'MEDIUM' then interval '12 hours'
        else interval '24 hours' end)
    order by issue.first_response_due_at nulls last, issue.id
    limit 100
    for update of issue skip locked
  loop
    if v_case.sent < 3 then
      insert into public.ops_audit_logs(issue_id, action_taken, performed_role, reason, before_state, after_state)
      values (v_case.id, 'SLA_REMINDER_DUE', 'SYSTEM', 'This case still needs an operator outcome.',
        jsonb_build_object('status', v_case.status, 'severity', v_case.severity),
        jsonb_build_object('status', v_case.status, 'severity', v_case.severity,
          'reminderAt', now(), 'reminderNumber', v_case.sent + 1, 'reminderLimit', 3));
    else
      v_correlation := gen_random_uuid();
      update public.ops_issues set canonical_status = 'ESCALATED', status = 'ESCALATED',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'lastEscalatedAt', now(), 'lastEscalatedBy', 'system/sla-reminder-cap',
          'lastEscalationReason', 'Three reminders exhausted; daily digest follow-up.',
          'escalatedToTeam', v_case.backup_team, 'slaReminderMode', 'DAILY_DIGEST')
      where id = v_case.id returning record_version into v_version;
      -- Do not fabricate an operator response or reset the actual SLA deadline.
      insert into public.ops_action_receipts(issue_id, action_key, idempotency_key,
        expected_record_version, resulting_record_version, outcome, human_status,
        correlation_id, next_action, completed_at)
      values (v_case.id, 'CASE_SLA_ESCALATE', v_case.cycle_key, v_case.record_version,
        v_version, 'SUCCEEDED', 'Reminder limit reached; backup-team escalation recorded.',
        v_correlation, 'Backup team ' || v_case.backup_team || ' must review. Further reminders are digest-only.', now())
      returning id into v_receipt;
      insert into public.ops_case_events(issue_id, event_type, sensitivity, actor_label,
        from_status, to_status, summary, payload, idempotency_key, correlation_id)
      values (v_case.id, 'ESCALATION', v_case.sensitivity, 'system/sla-reminder-cap',
        v_case.canonical_status, 'ESCALATED', 'Reminder limit reached; backup team must review.',
        jsonb_build_object('backupTeam', v_case.backup_team, 'receiptId', v_receipt, 'reminderMode', 'DAILY_DIGEST'),
        v_case.cycle_key, v_correlation);
      insert into public.ops_audit_logs(issue_id, action_taken, performed_role, reason, before_state, after_state)
      values (v_case.id, 'ISSUE_ESCALATED', 'SYSTEM',
        'Three reminders exhausted. Escalated once to the backup team; further follow-up is in the daily digest.',
        jsonb_build_object('status', v_case.status),
        jsonb_build_object('status', 'ESCALATED', 'backupTeam', v_case.backup_team,
          'receiptId', v_receipt, 'correlationId', v_correlation, 'reminderMode', 'DAILY_DIGEST'));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.enqueue_ops_slack_sla_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_ops_slack_sla_reminders() to service_role;
