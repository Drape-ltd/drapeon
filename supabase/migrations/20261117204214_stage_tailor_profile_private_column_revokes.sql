-- Release stage B0: close the private fields that the currently released
-- native clients do not project. Do not add payout or operational status
-- fields here: they remain readable until the RPC-capable mobile release and
-- the later B gate documented in docs/tailor-profile-owner-column-security.md.

do $$
declare
  immediate_column text;
begin
  foreach immediate_column in array array[
    'id_selfie_document_url',
    'id_verification_handoff_id',
    'is_test_profile'
  ]
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'tailor_profiles'
        and column_name = immediate_column
    ) then
      execute format(
        'revoke select (%1$I) on table public.tailor_profiles from authenticated',
        immediate_column
      );
    end if;
  end loop;
end $$;
