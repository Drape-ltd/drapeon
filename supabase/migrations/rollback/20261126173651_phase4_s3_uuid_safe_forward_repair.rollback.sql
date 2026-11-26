-- Forward-only money-schema repair. Do not drop retry claims, operations,
-- guards or functions after they may have become live dependencies.
do $rollback$
begin
  raise exception 'PHASE4_S3_FORWARD_ONLY: prepare a reviewed forward fix';
end;
$rollback$;
