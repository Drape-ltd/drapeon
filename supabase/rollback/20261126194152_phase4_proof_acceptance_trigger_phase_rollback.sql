-- A proof snapshot may exist after apply. Forward repair instead of restoring
-- a function known to reject an in-flight accepted quote.
do $$ begin raise exception 'PHASE4_PROOF_PHASE_FORWARD_ONLY'; end $$;
