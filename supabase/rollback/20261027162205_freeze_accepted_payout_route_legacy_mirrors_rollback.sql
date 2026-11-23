drop trigger if exists orders_accepted_payout_route_mirrors_immutable on public.orders;
drop function if exists private.guard_accepted_payout_route_legacy_mirrors();
