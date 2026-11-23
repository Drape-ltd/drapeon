-- Rollback for migration 20261028035153.
-- The reservation RPC is an additive extension of the existing service-only
-- tranche reservation and remains compatible with Stripe/legacy callers. Keep
-- it in place when rolling back Edge code; the prior Edge releaser refuses
-- BACHS before this RPC can be invoked. Remove the Bachs-only finalizer after
-- the provider path has drained.
drop function if exists public.finalize_claimed_bachs_tranche_release(uuid, text, text);
