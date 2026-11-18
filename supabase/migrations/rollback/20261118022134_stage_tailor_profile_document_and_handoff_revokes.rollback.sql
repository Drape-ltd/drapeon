-- Deliberately no-op. Reopening private profile fields is a forward-only,
-- compatibility-reviewed decision; do not restore grants during a rollback.
do $$ begin null; end $$;
