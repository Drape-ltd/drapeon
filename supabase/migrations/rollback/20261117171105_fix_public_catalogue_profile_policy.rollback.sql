-- Rehearsal rollback only: restores the prior policy shape.
drop policy if exists "customers: read tailor profile for shared orders"
  on public.tailor_profiles;

create policy "customers: read tailor profile for shared orders"
  on public.tailor_profiles
  for select
  to public
  using (
    exists (
      select 1
      from public.orders
      where orders.tailor_id = tailor_profiles.user_id
        and orders.customer_id = (select auth.uid())::text
    )
  );
