-- Roll back the Edge and Ops callers first; this function may then be removed.
drop function if exists public.complete_reviewed_failed_refund_journal_recovery(uuid,uuid,jsonb);
