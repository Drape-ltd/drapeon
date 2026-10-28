drop trigger if exists payout_claim_blocked_transition_guard on public.payout_claims;
drop function if exists public.prevent_unreviewed_blocked_payout_transition();
