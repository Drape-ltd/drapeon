-- Rehearsal rollback only. Restores the pre-forward policy target without
-- recreating or changing the policy predicate.

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tailor_profiles'
      and policyname = 'customers: read tailor profile for shared orders'
  ) then
    alter policy "customers: read tailor profile for shared orders"
      on public.tailor_profiles
      to public;
  end if;
end;
$$;
