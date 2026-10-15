-- Internal collaboration remains in audit/events/receipts, not the Slack outbox.
-- Preserve the existing sender, reminder cooldown, escalation, and terminal alerts.
-- Historical queued/delivered notifications are deliberately untouched.
create or replace trigger trg_enqueue_ops_slack_audit_event
after insert on public.ops_audit_logs
for each row
when (new.action_taken not in ('CASE_ADD_NOTE', 'CASE_ASSIGN_SELF', 'CASE_ACKNOWLEDGE'))
execute function public.enqueue_ops_slack_audit_event();
