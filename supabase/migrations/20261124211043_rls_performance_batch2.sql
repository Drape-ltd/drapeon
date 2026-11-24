-- #305 batch 2: initialize auth helpers once per statement and collapse
-- same-role/same-action permissive policies without widening Production access.

-- reviews: combine the public, customer, and tailor SELECT predicates.
drop policy if exists "Published reviews are public" on public.reviews;
drop policy if exists "public: read published reviews" on public.reviews;
drop policy if exists "parties: read own order review" on public.reviews;
drop policy if exists "customers: view own submitted reviews" on public.reviews;
drop policy if exists "tailors: view own reviews" on public.reviews;
create policy "Published or order-party reviews are readable"
on public.reviews for select to public
using (
  (published_at is not null and flagged = false)
  or exists (
    select 1
    from public.orders o
    where o.id::text = reviews.order_id::text
      and o.customer_id::text = (select auth.uid())::text
  )
  or (
    tailor_id is not null
    and tailor_id::text = (select auth.uid())::text
  )
);

drop policy if exists "customers: insert review for completed orders" on public.reviews;
create policy "customers: insert review for completed orders"
on public.reviews for insert to authenticated
with check (
  exists (
    select 1
    from public.orders o
    where o.id::text = reviews.order_id::text
      and o.customer_id::text = (select auth.uid())::text
      and o.tailor_profile_id::text = reviews.tailor_profile_id::text
      and (
        reviews.tailor_id is null
        or o.tailor_id is null
        or o.tailor_id::text = reviews.tailor_id::text
      )
      and o.stage = any (
        array[
          'COMPLETE'::public.order_stage,
          'DELIVERED'::public.order_stage,
          'COLLECTED'::public.order_stage
        ]
      )
  )
);

drop policy if exists "tailors: update own review response" on public.reviews;
create policy "tailors: update own review response"
on public.reviews for update to public
using (
  exists (
    select 1
    from public.tailor_profiles tp
    where tp.id::text = reviews.tailor_profile_id::text
      and tp.user_id::text = (select auth.uid())::text
  )
)
with check (
  exists (
    select 1
    from public.tailor_profiles tp
    where tp.id::text = reviews.tailor_profile_id::text
      and tp.user_id::text = (select auth.uid())::text
  )
);

-- customer_reviews: merge the two authenticated SELECT policies.
drop policy if exists "Customers read their own received reviews" on public.customer_reviews;
drop policy if exists "Tailors read reviews for their clients" on public.customer_reviews;
create policy "Customers and relevant tailors read customer reviews"
on public.customer_reviews for select to authenticated
using (
  (select auth.uid()) = customer_id
  or (select auth.uid()) = tailor_id
  or exists (
    select 1
    from public.orders o
    where o.customer_id::text = customer_reviews.customer_id::text
      and o.tailor_id::text = (select auth.uid())::text
  )
);

drop policy if exists "Tailors create review for completed client order" on public.customer_reviews;
create policy "Tailors create review for completed client order"
on public.customer_reviews for insert to authenticated
with check (
  (select auth.uid()) = tailor_id
  and exists (
    select 1
    from public.orders o
    where o.id::text = customer_reviews.order_id::text
      and o.customer_id::text = customer_reviews.customer_id::text
      and o.tailor_id::text = (select auth.uid())::text
      and o.stage = any (
        array[
          'DELIVERED'::public.order_stage,
          'COLLECTED'::public.order_stage,
          'COMPLETE'::public.order_stage
        ]
      )
  )
);

drop policy if exists "Tailors update their own client review" on public.customer_reviews;
create policy "Tailors update their own client review"
on public.customer_reviews for update to authenticated
using ((select auth.uid()) = tailor_id)
with check ((select auth.uid()) = tailor_id);

-- tailor_pickup_details: merge owner and unlocked-customer SELECT predicates.
drop policy if exists "tailor_pickup_details: customer sees unlocked pickup details" on public.tailor_pickup_details;
drop policy if exists "tailor_pickup_details: own row select" on public.tailor_pickup_details;
create policy "tailor_pickup_details: owner or unlocked customer reads"
on public.tailor_pickup_details for select to authenticated
using (
  user_id::text = (select auth.uid())::text
  or exists (
    select 1
    from public.orders o
    where o.tailor_id::text = tailor_pickup_details.user_id::text
      and o.customer_id::text = (select auth.uid())::text
      and o.delivery_method = 'LOCAL_COLLECTION'::public.delivery_method
      and o.stage = any (
        array[
          'READY_FOR_COLLECTION'::public.order_stage,
          'COLLECTED'::public.order_stage,
          'COMPLETE'::public.order_stage,
          'IN_DISPUTE'::public.order_stage
        ]
      )
  )
);

drop policy if exists "tailor_pickup_details: own row insert" on public.tailor_pickup_details;
create policy "tailor_pickup_details: own row insert"
on public.tailor_pickup_details for insert to authenticated
with check (user_id::text = (select auth.uid())::text);

drop policy if exists "tailor_pickup_details: own row update" on public.tailor_pickup_details;
create policy "tailor_pickup_details: own row update"
on public.tailor_pickup_details for update to authenticated
using (user_id::text = (select auth.uid())::text)
with check (user_id::text = (select auth.uid())::text);

-- web_push_subscriptions: four action-specific owner policies.
drop policy if exists "users: delete own account web push subscriptions" on public.web_push_subscriptions;
create policy "users: delete own account web push subscriptions"
on public.web_push_subscriptions for delete to authenticated
using (audience = 'ACCOUNT' and user_id = (select auth.uid()));

drop policy if exists "users: insert own account web push subscriptions" on public.web_push_subscriptions;
create policy "users: insert own account web push subscriptions"
on public.web_push_subscriptions for insert to authenticated
with check (audience = 'ACCOUNT' and user_id = (select auth.uid()));

drop policy if exists "users: read own account web push subscriptions" on public.web_push_subscriptions;
create policy "users: read own account web push subscriptions"
on public.web_push_subscriptions for select to authenticated
using (audience = 'ACCOUNT' and user_id = (select auth.uid()));

drop policy if exists "users: update own account web push subscriptions" on public.web_push_subscriptions;
create policy "users: update own account web push subscriptions"
on public.web_push_subscriptions for update to authenticated
using (audience = 'ACCOUNT' and user_id = (select auth.uid()))
with check (audience = 'ACCOUNT' and user_id = (select auth.uid()));

-- conversation_translation_preferences: three participant-owner policies.
drop policy if exists "translation preferences: participant inserts own" on public.conversation_translation_preferences;
create policy "translation preferences: participant inserts own"
on public.conversation_translation_preferences for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.orders o
    where o.id = conversation_translation_preferences.order_id
      and (
        (select auth.uid())::text = o.customer_id::text
        or (select auth.uid())::text = o.tailor_id::text
      )
  )
);

drop policy if exists "translation preferences: participant reads own" on public.conversation_translation_preferences;
create policy "translation preferences: participant reads own"
on public.conversation_translation_preferences for select to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.orders o
    where o.id = conversation_translation_preferences.order_id
      and (
        (select auth.uid())::text = o.customer_id::text
        or (select auth.uid())::text = o.tailor_id::text
      )
  )
);

drop policy if exists "translation preferences: participant updates own" on public.conversation_translation_preferences;
create policy "translation preferences: participant updates own"
on public.conversation_translation_preferences for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
