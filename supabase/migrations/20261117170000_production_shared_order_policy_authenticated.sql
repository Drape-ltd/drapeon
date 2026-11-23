-- Production forward replacement for 20261117171105.
--
-- The original source drops and recreates this policy with a text cast in its
-- shared-order predicate. That is incompatible with Production's UUID order
-- IDs and would make an indexed orders.customer_id comparison non-sargable.
--
-- Keep the predicate exactly as each environment already has it and change
-- only the policy target role. This is deliberately a no-op when an older
-- environment does not have the legacy shared-order policy at all.

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
      to authenticated;
  end if;
end;
$$;
