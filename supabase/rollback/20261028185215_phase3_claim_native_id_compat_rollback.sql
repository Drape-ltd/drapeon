-- Forward-only: restoring the native UUID foreign keys would fail on Production's
-- text-based claim IDs. Removing generated ID bridges could also break later
-- claim/case migrations, so preserve them and use a reviewed forward migration.
do $rollback$
begin
  raise exception 'Forward-only migration: preserve provider-neutral text-ID claim references';
end
$rollback$;
