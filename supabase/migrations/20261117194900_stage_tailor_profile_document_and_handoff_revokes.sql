-- Production B0a. These document-location fields are unused by released web
-- and native client projections. Revoking them before the helper rewrite is
-- safe because current Production RLS policies do not reference either field.
--
-- Do not add is_test_profile here: current portfolio and shop policies still
-- evaluate it directly. Its revoke belongs in 20261118022149 after
-- 20261118014508 rewrites those policies through SECURITY DEFINER helpers.

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
