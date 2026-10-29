-- Local Production-shaped rehearsal only. Do not remove a live money RPC in
-- Production without first withdrawing its Edge caller.
drop function if exists public.block_tip_payout_identity_conflict(uuid,text,jsonb);
