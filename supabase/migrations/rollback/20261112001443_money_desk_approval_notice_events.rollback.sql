-- Roll back only after older application writers are restored. This deliberately
-- refuses to discard immutable email outcome events if any have been written.
set local lock_timeout = '5s';

alter table public.money_desk_events
  drop constraint money_desk_events_event_type_check;

alter table public.money_desk_events
  add constraint money_desk_events_event_type_check check (event_type in (
    'REQUEST_SUBMITTED', 'APPROVAL_RECORDED', 'REQUEST_APPROVED', 'REQUEST_REJECTED',
    'EXECUTION_STARTED', 'EXECUTION_SUCCEEDED', 'EXECUTION_FAILED', 'EXECUTION_BLOCKED',
    'REQUEST_CANCELLED'
  ));
