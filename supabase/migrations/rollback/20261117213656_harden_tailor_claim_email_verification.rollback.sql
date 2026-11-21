-- Restore the prior wrapper only by rolling back the complete claim-email
-- migration set. Reintroducing its state-gate ordering bug is unsafe.
do $$ begin null; end $$;
