-- The Ops cases are retained as audit evidence. Reverse only links explicitly
-- created by this backfill; PREPARED links created by application code survive.
update public.order_payments
set consultation_booking_id = null,
    consultation_booking_link_source = null
where consultation_booking_link_source = 'BACKFILL';
