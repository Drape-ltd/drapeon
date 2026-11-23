-- The catalogue is loaded by the browser with the public key. The shared-order
-- policy previously applied to that role while reading `orders`, which anon is
-- deliberately not allowed to select. PostgreSQL evaluates the policy while
-- resolving nested tailor_profiles for seller_items, so that made every public
-- catalogue query fail with `permission denied for table orders`.
--
-- A shared-order check only makes sense for an authenticated customer. Keeping
-- it off the public role preserves the existing public live-profile policy and
-- prevents the private orders table from participating in public catalogue
-- reads.
drop policy if exists "customers: read tailor profile for shared orders"
  on public.tailor_profiles;

create policy "customers: read tailor profile for shared orders"
  on public.tailor_profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders
      where orders.tailor_id = tailor_profiles.user_id
        and orders.customer_id = (select auth.uid())::text
    )
  );
