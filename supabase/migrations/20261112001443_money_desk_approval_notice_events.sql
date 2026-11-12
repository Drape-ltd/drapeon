-- Money Desk notification writers already emit these three terminal outcomes.
-- Keep the append-only event log able to record them.
begin;
set local lock_timeout = '5s';

alter table public.money_desk_events
  drop constraint money_desk_events_event_type_check;

alter table public.money_desk_events
  add constraint money_desk_events_event_type_check check (event_type in (
    'REQUEST_SUBMITTED', 'APPROVAL_RECORDED', 'REQUEST_APPROVED', 'REQUEST_REJECTED',
    'EXECUTION_STARTED', 'EXECUTION_SUCCEEDED', 'EXECUTION_FAILED', 'EXECUTION_BLOCKED',
    'REQUEST_CANCELLED',
    'FOUNDER_APPROVAL_EMAIL_SENT', 'FOUNDER_APPROVAL_EMAIL_SKIPPED',
    'FOUNDER_APPROVAL_EMAIL_FAILED'
  ));
commit;
