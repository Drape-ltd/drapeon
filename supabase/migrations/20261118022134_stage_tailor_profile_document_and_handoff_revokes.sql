-- Dev-only historical B0a staging record. Production receives this same
-- two-column revoke as part of 20261117194812, before any web merge. Keep this
-- file only so Dev migration history remains reproducible; never promote it to
-- Production as a second batch action.

do $$
declare
  private_column text;
begin
  foreach private_column in array array[
    'id_selfie_document_url',
    'id_verification_handoff_id'
  ]
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'tailor_profiles'
        and column_name = private_column
    ) then
      execute format(
        'revoke select (%1$I) on table public.tailor_profiles from authenticated',
        private_column
      );
    end if;
  end loop;
end $$;
