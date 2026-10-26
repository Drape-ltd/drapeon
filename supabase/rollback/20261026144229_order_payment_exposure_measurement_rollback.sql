drop trigger if exists payouts_refresh_order_payment_exposure on public.payouts;
drop trigger if exists orders_record_payment_exposure_at_acceptance on public.orders;

drop function if exists private.refresh_order_payment_exposure_from_payout();
drop function if exists private.record_order_payment_exposure_at_acceptance();

drop table if exists public.order_payment_exposure_measurements;
