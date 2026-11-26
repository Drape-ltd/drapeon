-- Forward-only money-guard repair. Restore reviewed prior definitions with a
-- new migration if a semantic regression is found; do not replay money rows.
do $rollback$
begin
  raise exception 'PHASE4_S3_MERGED_GUARDS_FORWARD_ONLY';
end;
$rollback$;
