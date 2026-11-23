-- These changes authorize provider-neutral recovery for accepted adjustment
-- earnings. Remove the dependent Edge entrypoint instead of restoring the
-- Stripe-only reservation and finalizer after they may have handled money.
do $$ begin
  raise exception 'Reviewed adjustment payout snapshot guards are forward-only; disable the dependent Edge entrypoint instead of reverting payout behavior';
end $$;
