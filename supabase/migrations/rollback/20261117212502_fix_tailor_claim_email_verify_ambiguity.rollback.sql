-- Intentionally irreversible: restoring the ambiguous upsert would break the
-- fifth-attempt lock. Roll back the feature migration instead.
do $$ begin null; end $$;
