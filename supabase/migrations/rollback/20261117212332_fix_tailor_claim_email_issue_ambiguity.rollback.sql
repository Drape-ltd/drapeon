-- Intentionally irreversible: restoring the ambiguous ON CONFLICT expression
-- would make claim-email issuance fail. Roll back the feature migration instead.
do $$ begin null; end $$;
