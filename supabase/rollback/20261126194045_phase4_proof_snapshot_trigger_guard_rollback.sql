-- A live proof order may already hold a disabled-route snapshot. Restoring
-- the old trigger would make reconciliation behavior ambiguous. Forward fix.
do $$ begin raise exception 'PHASE4_PROOF_TRIGGER_FORWARD_ONLY'; end $$;
