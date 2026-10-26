drop trigger if exists payouts_order_earning_tranche_exclusive
  on public.payouts;

drop function if exists private.guard_order_payout_policy_exclusivity();
