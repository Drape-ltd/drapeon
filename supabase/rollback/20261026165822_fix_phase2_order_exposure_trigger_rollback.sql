-- Forward-only production safety fix: reverting would restore a trigger that
-- references a nonexistent orders column and rejects accepted routed orders.
do $rollback$
begin
  raise exception 'Forward-only migration: refusing to restore the broken Phase 2 exposure trigger';
end
$rollback$;
