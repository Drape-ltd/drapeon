-- Only after the Edge caller is reverted. Existing blocked claims and Ops cases
-- are retained as history; this removes only the new service-only entrypoint.
drop function if exists public.block_confirmed_payout_identity_conflict(uuid,jsonb);
