-- #305 batch 3: preserve the live Production predicates while removing
-- duplicate permissive branches and initializing auth.uid() once per statement.

-- disputes is authenticated-only: anon cannot SELECT orders, so do not expose
-- either order-dependent branch to anon/public.
drop policy if exists "Order customer sees their dispute" on public.disputes;
drop policy if exists "Order tailor sees dispute" on public.disputes;
create policy "Order parties see their dispute"
on public.disputes for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = disputes.order_id
      and o.customer_id::text = (select auth.uid())::text
  )
  or exists (
    select 1 from public.orders o
    join public.tailor_profiles tp on tp.id = o.tailor_profile_id
    where o.id = disputes.order_id
      and tp.user_id::text = (select auth.uid())::text
  )
);

-- order_group_members is authenticated-only. Split the old ALL policy by
-- command so SELECT has one permissive policy containing both live branches.
drop policy if exists "Order owners manage group members" on public.order_group_members;
drop policy if exists "Invited users view their group member row" on public.order_group_members;
create policy "Order owners or invitees view group members"
on public.order_group_members for select to authenticated
using (
  owner_customer_id = (select auth.uid())
  or invited_user_id = (select auth.uid())
);
create policy "Order owners insert group members"
on public.order_group_members for insert to authenticated
with check (owner_customer_id = (select auth.uid()));
create policy "Order owners update group members"
on public.order_group_members for update to authenticated
using (owner_customer_id = (select auth.uid()))
with check (owner_customer_id = (select auth.uid()));
create policy "Order owners delete group members"
on public.order_group_members for delete to authenticated
using (owner_customer_id = (select auth.uid()));

-- push_tokens had two equivalent owner policies, one inherited by anon via
-- public. Keep one authenticated policy and initialize auth.uid().
drop policy if exists "User manages their own push token" on public.push_tokens;
drop policy if exists "users: manage own push token" on public.push_tokens;
create policy "users: manage own push token"
on public.push_tokens for all to authenticated
using (user_id::text = (select auth.uid())::text)
with check (user_id::text = (select auth.uid())::text);

-- Portfolio public reads remain anon-reachable without joining private tables.
-- Authenticated SELECT combines the public and owner branches exactly once.
drop policy if exists "public: view live portfolio" on public.portfolio_items;
drop policy if exists "tailor: own portfolio" on public.portfolio_items;
create policy "anon: view live portfolio"
on public.portfolio_items for select to anon
using (is_public_tailor_profile(tailor_profile_id::text));
create policy "authenticated: view live or own portfolio"
on public.portfolio_items for select to authenticated
using (
  is_public_tailor_profile(tailor_profile_id::text)
  or is_my_tailor_profile(tailor_profile_id::text)
);
create policy "tailor: insert own portfolio"
on public.portfolio_items for insert to authenticated
with check (is_my_tailor_profile(tailor_profile_id::text));
create policy "tailor: update own portfolio"
on public.portfolio_items for update to authenticated
using (is_my_tailor_profile(tailor_profile_id::text))
with check (is_my_tailor_profile(tailor_profile_id::text));
create policy "tailor: delete own portfolio"
on public.portfolio_items for delete to authenticated
using (is_my_tailor_profile(tailor_profile_id::text));

drop policy if exists "public: read public portfolio photos" on public.portfolio_photos;
drop policy if exists "tailors: manage own portfolio photos" on public.portfolio_photos;
create policy "anon: read public portfolio photos"
on public.portfolio_photos for select to anon
using (is_public_tailor_profile(tailor_profile_id::text));
create policy "authenticated: read public or own portfolio photos"
on public.portfolio_photos for select to authenticated
using (
  is_public_tailor_profile(tailor_profile_id::text)
  or is_my_tailor_profile(tailor_profile_id::text)
);
create policy "tailors: insert own portfolio photos"
on public.portfolio_photos for insert to authenticated
with check (is_my_tailor_profile(tailor_profile_id::text));
create policy "tailors: update own portfolio photos"
on public.portfolio_photos for update to authenticated
using (is_my_tailor_profile(tailor_profile_id::text))
with check (is_my_tailor_profile(tailor_profile_id::text));
create policy "tailors: delete own portfolio photos"
on public.portfolio_photos for delete to authenticated
using (is_my_tailor_profile(tailor_profile_id::text));
