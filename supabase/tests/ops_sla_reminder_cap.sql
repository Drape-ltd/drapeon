-- Run against DEVELOPMENT after cap_ops_sla_reminders is installed.
-- The entire rehearsal, including outbox writes, rolls back: no Slack delivery.
begin;
do $$
declare
  v_id uuid := gen_random_uuid();
  v_count integer;
  v_number integer;
begin
  if public.current_ops_environment() <> 'DEVELOPMENT' then
    raise exception 'This rehearsal is development-only';
  end if;
  if position('sla-reminder-cap' in pg_get_functiondef('public.enqueue_ops_slack_sla_reminders()'::regprocedure)) = 0 then
    raise exception 'Install the reminder-cap migration before this rehearsal';
  end if;
  insert into public.ops_issues(id, issue_type, severity, status, source, title,
    description, recommended_action, dedupe_key, environment, provenance,
    canonical_status, queue_key, owning_team, priority, sensitivity,
    created_at, first_response_due_at, active_resolution_due_at, sla_policy_version)
  values (v_id, 'SYSTEM_ALERT', 'HIGH', 'OPEN', 'ops-reminder-regression',
    'Rollback-only reminder fixture', 'No external alert should survive this transaction.',
    'Development verification only.', 'reminder-test:' || v_id, 'DEVELOPMENT', 'QA',
    'NEW', 'reliability', 'engineering', 'P1', 'INTERNAL',
    now() - interval '100 days', now() - interval '99 days', now() - interval '98 days', 'reliability-v1');

  for v_number in 1..3 loop
    perform public.enqueue_ops_slack_sla_reminders();
    select count(*) into v_count from public.ops_audit_logs
      where issue_id = v_id and action_taken = 'SLA_REMINDER_DUE';
    if v_count <> v_number then raise exception 'Expected reminder %, got %', v_number, v_count; end if;
    -- A repeated invocation inside the cooldown must not duplicate the reminder.
    perform public.enqueue_ops_slack_sla_reminders();
    if (select count(*) from public.ops_audit_logs where issue_id = v_id and action_taken = 'SLA_REMINDER_DUE') <> v_number then
      raise exception 'Cooldown allowed a duplicate reminder';
    end if;
    update public.ops_audit_logs set created_at = now() - interval '2 days'
      where issue_id = v_id and action_taken = 'SLA_REMINDER_DUE';
  end loop;
  perform public.enqueue_ops_slack_sla_reminders();
  perform public.enqueue_ops_slack_sla_reminders();
  if (select count(*) from public.ops_audit_logs where issue_id = v_id and action_taken = 'SLA_REMINDER_DUE') <> 3 then
    raise exception 'Reminder cap was exceeded';
  end if;
  if (select count(*) from public.ops_action_receipts where issue_id = v_id and action_key = 'CASE_SLA_ESCALATE') <> 1 then
    raise exception 'Escalation must have exactly one durable receipt';
  end if;
  if not exists (select 1 from public.ops_issues where id = v_id and canonical_status = 'ESCALATED'
    and first_responded_at is null and metadata->>'slaReminderMode' = 'DAILY_DIGEST'
    and metadata->>'escalatedToTeam' is not null) then
    raise exception 'Escalation lost backup ownership, digest mode, or fabricated a human response';
  end if;

  -- A genuine recorded reopen starts a fresh lifecycle; pause still suppresses it.
  insert into public.ops_case_events(issue_id,event_type,actor_label,summary,idempotency_key,correlation_id)
  values (v_id,'REOPEN','regression','Rollback-only reopen','reopen-test:' || v_id,gen_random_uuid());
  update public.ops_issues set canonical_status='NEW',status='OPEN',sla_clock_paused_at=now() where id=v_id;
  perform public.enqueue_ops_slack_sla_reminders();
  if (select count(*) from public.ops_audit_logs where issue_id = v_id and action_taken = 'SLA_REMINDER_DUE') <> 3 then
    raise exception 'Paused case received a reminder';
  end if;
  update public.ops_issues set sla_clock_paused_at=null where id=v_id;
  perform public.enqueue_ops_slack_sla_reminders();
  if (select count(*) from public.ops_audit_logs where issue_id = v_id and action_taken = 'SLA_REMINDER_DUE') <> 4 then
    raise exception 'Reopened case did not start a fresh reminder lifecycle';
  end if;
end;
$$;
rollback;
