-- Production B0b. This follows the helper rewrite so public portfolio and
-- seller-item policies no longer evaluate is_test_profile with the visitor's
-- column privileges. The public helper evaluates the predicate inside its
-- SECURITY DEFINER boundary instead.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tailor_profiles'
      and column_name = 'is_test_profile'
  ) then
    revoke select (is_test_profile) on table public.tailor_profiles from authenticated;
  end if;
end $$;
