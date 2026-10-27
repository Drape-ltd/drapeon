-- Roll back only after reverting the booking-link backfill and application code.
drop function if exists public.claim_consultation_money_action(uuid, text);
alter table public.order_payments
  drop constraint if exists order_payments_consultation_booking_link_pair_check,
  drop constraint if exists order_payments_consultation_booking_link_source_check,
  drop column if exists consultation_booking_link_source;
-- consultation_booking_id and its index predate this migration in Dev. Keep
-- them on rollback so an older verified link cannot be destroyed.
