-- Forward-only security repair: never restore a table-wide SELECT grant.
-- The forward migration is a no-op on the established per-column baseline, so
-- no rollback action is necessary or safe.
do $$ begin end $$;
