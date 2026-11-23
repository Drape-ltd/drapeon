-- A null reminderMode is an actionable escalation, not a digest-only one.
-- Coalesce explicitly so SQL's UNKNOWN result cannot suppress the audit trigger.
create or replace trigger trg_enqueue_ops_slack_audit_event
after insert on public.ops_audit_logs
for each row
when (
  new.action_taken not in ('CASE_ADD_NOTE', 'CASE_ASSIGN_SELF', 'CASE_ACKNOWLEDGE')
  and not (
    new.action_taken = 'ISSUE_ESCALATED'
    and new.performed_role = 'SYSTEM'
    and coalesce(new.after_state ->> 'reminderMode', '') = 'DAILY_DIGEST'
  )
)
execute function public.enqueue_ops_slack_audit_event();
