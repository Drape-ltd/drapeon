-- Use only if the claim runner has been reverted and no conflict is being handled.
drop function if exists public.block_payout_claim_identity_conflict(uuid,jsonb);
