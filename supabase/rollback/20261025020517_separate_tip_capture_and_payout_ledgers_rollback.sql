-- Forward-only ledger identity migration. Dev payout claims may already point
-- to separate payout journals; moving them back onto the captured tip row can
-- overwrite capture evidence or make a retry post a duplicate journal.
do $$ begin raise exception 'Separate tip capture/payout journals are forward-only; rollback refused to preserve ledger identity'; end $$;
