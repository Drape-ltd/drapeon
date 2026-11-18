-- Deliberately no-op. Reopening is_test_profile requires a forward
-- compatibility migration, never an automatic rollback grant.
do $$ begin null; end $$;
