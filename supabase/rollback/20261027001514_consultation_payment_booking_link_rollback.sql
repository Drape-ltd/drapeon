-- Roll back only after reverting the booking-link backfill and application code.
drop function if exists public.claim_consultation_money_action(uuid, text);
drop index if exists public.order_payments_consultation_booking_idx;
alter table public.order_payments
  drop constraint if exists order_payments_consultation_booking_link_pair_check,
  drop constraint if exists order_payments_consultation_booking_link_source_check,
  drop column if exists consultation_booking_link_source,
  drop column if exists consultation_booking_id;
