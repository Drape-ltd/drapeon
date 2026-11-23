-- Drop only the entrypoint. Keep financial claims, attempts, and provider IDs.
drop function public.record_payout_attempt_outcome(uuid,text,text,jsonb);
-- Keep the unique provider-transfer index as a data-integrity guard.
