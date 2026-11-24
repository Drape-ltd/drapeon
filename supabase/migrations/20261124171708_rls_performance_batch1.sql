-- #305 batch 1: preserve access while reducing auth initplans and policy fan-out.

-- orders (5 policies -> 3)
-- Dev carried older equivalents; these are no-ops on the Production baseline.
drop policy if exists "customers: create orders" on public.orders;
drop policy if exists "customers: read own orders" on public.orders;
drop policy if exists "tailors: read assigned orders" on public.orders;
drop policy if exists "customers: update own orders" on public.orders;
drop policy if exists "tailors: update assigned orders" on public.orders;
drop policy if exists "Customer creates orders" on public.orders;
create policy "Customer creates orders" on public.orders for insert to authenticated
with check (
  (select auth.uid())::text = customer_id::text
  and (
    (coalesce(order_kind::text, 'CUSTOM') = 'CUSTOM' and stage = 'PENDING_QUOTE'::public.order_stage
      and exists (select 1 from public.tailor_profiles tp where tp.id::text = orders.tailor_profile_id::text and tp.is_live = true and (orders.tailor_id is null or orders.tailor_id::text = tp.user_id::text)))
    or
    (order_kind::text = 'READY_MADE' and stage = any (array['PENDING_QUOTE'::public.order_stage, 'CONFIRMED'::public.order_stage]) and seller_item_id is not null
      and exists (select 1 from public.tailor_profiles tp join public.seller_items si on si.tailor_profile_id::text = tp.id::text where tp.id::text = orders.tailor_profile_id::text and tp.is_live = true and si.id::text = orders.seller_item_id and coalesce(si.is_live, false) = true and coalesce(si.stock_status, 'IN_STOCK') <> all (array['SOLD_OUT', 'HIDDEN']) and (orders.tailor_id is null or orders.tailor_id::text = tp.user_id::text)))
  )
);

drop policy if exists "Customer sees their orders" on public.orders;
drop policy if exists "Tailor sees their orders" on public.orders;
create policy "Order parties see their orders" on public.orders for select to public
using (
  (select auth.uid())::text = customer_id::text
  or exists (select 1 from public.tailor_profiles tp where tp.id = orders.tailor_profile_id and tp.user_id::text = (select auth.uid())::text)
);

drop policy if exists "Customer updates their orders" on public.orders;
drop policy if exists "Tailor updates their orders" on public.orders;
create policy "Order parties update active orders" on public.orders for update to public
using (((customer_id::text = (select auth.uid())::text) or (tailor_id::text = (select auth.uid())::text)) and not public.is_terminal_order_stage(stage))
with check (((customer_id::text = (select auth.uid())::text) or (tailor_id::text = (select auth.uid())::text)) and not public.is_terminal_order_stage(stage));

-- messages (4 policies -> 3)
drop policy if exists "parties: read messages for own orders" on public.messages;
drop policy if exists "Order parties send messages" on public.messages;
drop policy if exists "parties: send messages on own orders" on public.messages;
create policy "Order parties send messages" on public.messages for insert to public
with check (
  (
    (select auth.uid())::text = sender_id::text
    and exists (select 1 from public.orders o where o.id = messages.order_id and (o.customer_id::text = (select auth.uid())::text or exists (select 1 from public.tailor_profiles tp where tp.id = o.tailor_profile_id and tp.user_id::text = (select auth.uid())::text)))
  )
  or
  (
    (select auth.uid())::text = sender_id::text
    and exists (select 1 from public.orders o where o.id = messages.order_id and (o.customer_id::text = (select auth.uid())::text or o.tailor_id::text = (select auth.uid())::text))
    and (
      (sender_role = 'CUSTOMER' and exists (select 1 from public.orders o where o.id = messages.order_id and o.customer_id::text = (select auth.uid())::text))
      or (sender_role = 'TAILOR' and exists (select 1 from public.orders o where o.id = messages.order_id and o.tailor_id::text = (select auth.uid())::text))
    )
  )
);

drop policy if exists "Order parties see messages" on public.messages;
create policy "Order parties see messages" on public.messages for select to public
using (exists (select 1 from public.orders o where o.id = messages.order_id and (o.customer_id::text = (select auth.uid())::text or exists (select 1 from public.tailor_profiles tp where tp.id = o.tailor_profile_id and tp.user_id::text = (select auth.uid())::text))));

drop policy if exists "parties: mark received messages read" on public.messages;
create policy "parties: mark received messages read" on public.messages for update to public
using (sender_id::text <> (select auth.uid())::text and exists (select 1 from public.orders o where o.id = messages.order_id and (o.customer_id::text = (select auth.uid())::text or exists (select 1 from public.tailor_profiles tp where tp.id::text = o.tailor_profile_id::text and tp.user_id::text = (select auth.uid())::text))))
with check (read_at is not null);

-- tailor_profiles (7 permissive policies -> 4)
drop policy if exists "Live tailor profiles are readable by authenticated users" on public.tailor_profiles;
drop policy if exists "Tailors can read their own profile" on public.tailor_profiles;
drop policy if exists "customers: read tailor profile for shared orders" on public.tailor_profiles;
drop policy if exists "public: read live tailor profiles" on public.tailor_profiles;
drop policy if exists "tailors: read own profile" on public.tailor_profiles;
drop policy if exists "Tailor owns their profile" on public.tailor_profiles;
drop policy if exists "tailor_profiles: own row insert" on public.tailor_profiles;
drop policy if exists "tailors: insert own profile" on public.tailor_profiles;
drop policy if exists "Public can view live tailor profiles" on public.tailor_profiles;
drop policy if exists "tailor_profiles: own row select" on public.tailor_profiles;
drop policy if exists "tailor_profiles: own row update" on public.tailor_profiles;
drop policy if exists "tailors: update own profile" on public.tailor_profiles;

create policy "Public or owner reads tailor profiles" on public.tailor_profiles for select to public
using ((is_live = true and is_verified = true and is_test_profile = false and lifecycle_state = 'LIVE') or user_id::text = (select auth.uid())::text);
create policy "Tailor inserts own profile" on public.tailor_profiles for insert to public
with check (user_id::text = (select auth.uid())::text);
create policy "Tailor updates own profile" on public.tailor_profiles for update to public
using (user_id::text = (select auth.uid())::text) with check (user_id::text = (select auth.uid())::text);
create policy "Tailor deletes own profile" on public.tailor_profiles for delete to public
using (user_id::text = (select auth.uid())::text);

-- customer_profiles (2 permissive policies -> 4 action-specific policies)
drop policy if exists "customers: insert own profile" on public.customer_profiles;
drop policy if exists "customers: read own profile" on public.customer_profiles;
drop policy if exists "tailors: read customer profile for shared orders" on public.customer_profiles;
drop policy if exists "customers: update own profile" on public.customer_profiles;
drop policy if exists "Customer owns their profile" on public.customer_profiles;
drop policy if exists "Tailor reads customer profile for active orders" on public.customer_profiles;

create policy "Customer or active-order tailor reads customer profile" on public.customer_profiles for select to public
using (
  (select auth.uid())::text = user_id::text
  or exists (
    select 1 from public.orders o join public.tailor_profiles tp on tp.id = o.tailor_profile_id
    where o.customer_id::text = customer_profiles.user_id::text and tp.user_id::text = (select auth.uid())::text
      and o.stage <> all (array['DRAFT'::public.order_stage, 'DECLINED'::public.order_stage, 'EXPIRED'::public.order_stage, 'CANCELLED'::public.order_stage])
  )
);
create policy "Customer inserts own profile" on public.customer_profiles for insert to public
with check ((select auth.uid())::text = user_id::text);
create policy "Customer updates own profile" on public.customer_profiles for update to public
using ((select auth.uid())::text = user_id::text) with check ((select auth.uid())::text = user_id::text);
create policy "Customer deletes own profile" on public.customer_profiles for delete to public
using ((select auth.uid())::text = user_id::text);
