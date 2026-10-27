-- Keep every SLA reminder in the Ops audit timeline, but do not turn every
-- reminder into a Slack push. New cases, escalations and operator actions keep
-- their existing immediate delivery path.
create or replace function public.enqueue_ops_slack_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_severity text;
  v_quiet_period interval;
begin
  if new.action_taken = 'SLA_REMINDER_DUE' then
    select severity into v_severity
    from public.ops_issues
    where id = new.issue_id;

    -- Medium and low cases are still recorded in the Ops timeline. Their
    -- initial creation and any escalation continue to notify Slack.
    if v_severity not in ('CRITICAL', 'HIGH') or v_severity is null then
      return new;
    end if;

    v_quiet_period := case v_severity
      when 'CRITICAL' then interval '4 hours'
      else interval '24 hours'
    end;

    -- Count queued reminders rather than only successful Slack responses, so
    -- a slow/retrying worker cannot spawn another notification for the case.
    if exists (
      select 1
      from public.ops_audit_logs prior
      join public.domain_events event
        on event.idempotency_key = 'ops-slack-audit:' || prior.id::text
      where prior.issue_id = new.issue_id
        and prior.id <> new.id
        and prior.action_taken = 'SLA_REMINDER_DUE'
        and prior.created_at >= new.created_at - v_quiet_period
      limit 1
    ) then
      return new;
    end if;
  end if;

  perform public.enqueue_domain_event(
    p_event_type := 'ops.issue.slack_delivery_requested',
    p_aggregate_type := 'ops_issue',
    p_idempotency_key := 'ops-slack-audit:' || new.id::text,
    p_payload := jsonb_build_object(
      'issueId', new.issue_id,
      'auditLogId', new.id
    ),
    p_aggregate_id := new.issue_id::text,
    p_actor_id := null,
    p_actor_role := coalesce(nullif(new.performed_role, ''), 'SYSTEM'),
    p_order_id := null,
    p_metadata := jsonb_build_object('action', new.action_taken),
    p_jobs := array['SEND_OPS_SLACK']::text[],
    p_priority := case
      when new.action_taken in ('ISSUE_CREATED', 'ISSUE_REOPENED', 'ISSUE_ESCALATED') then 10
      else 40
    end,
    p_max_attempts := 8,
    p_run_at := now()
  );
  return new;
end;
$$;

revoke all on function public.enqueue_ops_slack_audit_event() from public, anon, authenticated;
grant execute on function public.enqueue_ops_slack_audit_event() to service_role;
