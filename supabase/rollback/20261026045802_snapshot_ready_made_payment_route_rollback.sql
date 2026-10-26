-- Remove the ready-made snapshot RPC. Do not roll this back after any
-- ready-made order has been snapshotted without first applying an audited
-- forward repair, because accepted route snapshots are immutable by design.
drop function if exists public.snapshot_ready_made_payment_route(
  text, uuid, uuid, integer, uuid, integer, uuid, text, text
);

alter table public.order_events
  drop constraint if exists order_events_event_type_check;

alter table public.order_events
  add constraint order_events_event_type_check
  check (
    event_type in (
      'QUOTE_SENT', 'QUOTE_REVISED', 'QUOTE_RENEWED', 'QUOTE_SUPERSEDED',
      'QUOTE_ACCEPTED', 'QUOTE_DECLINED', 'QUOTE_EXPIRED',
      'QUOTE_REVISION_REQUESTED', 'QUOTE_REVISION_EDITED',
      'QUOTE_REVISION_WITHDRAWN', 'QUOTE_RETAINED', 'PAYMENT_CONFIRMED',
      'SCOPE_CHANGE_REQUESTED', 'FABRIC_DECISION_RECORDED',
      'MEASUREMENT_DECISION_RECORDED', 'FULFILLMENT_DECISION_RECORDED',
      'REMEDY_DECISION_RECORDED', 'APPOINTMENT_PROPOSED',
      'APPOINTMENT_COUNTERED', 'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_CANCELLED', 'APPOINTMENT_COMPLETED',
      'APPOINTMENT_NO_SHOW', 'APPOINTMENT_EXPIRED'
    )
  );
