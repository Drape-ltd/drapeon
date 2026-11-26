-- Forward-only security repair. Restoring the prior defaults would grant
-- future public tables and functions to client roles again.
do $rollback$
begin
  raise exception 'PHASE4_DEFAULT_ACL_FORWARD_ONLY';
end;
$rollback$;
