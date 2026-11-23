-- These tables become durable money-operation evidence once writers are released.
-- A rollback must preserve claims; disable dependent entrypoints instead.
do $$ begin
  raise exception 'Forward-only money-claim foundation: do not drop operation claims or consultation refund holds';
end $$;
