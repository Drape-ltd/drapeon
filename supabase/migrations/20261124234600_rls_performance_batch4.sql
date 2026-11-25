-- #305 batch 4: preserve the live Production predicates while initializing
-- auth.uid() once per statement and removing seller_items SELECT overlap.

-- seller_items keeps its public read branch independent from owner-only writes.
-- Authenticated SELECT combines the two live permissive branches exactly once.
drop policy if exists "public reads live seller items" on public.seller_items;
drop policy if exists "tailors manage own seller items" on public.seller_items;

create policy "anon reads live seller items"
on public.seller_items for select to anon
using (
  is_live
  and is_public_tailor_profile(tailor_profile_id::text)
);

create policy "authenticated reads live or own seller items"
on public.seller_items for select to authenticated
using (
  (
    is_live
    and is_public_tailor_profile(tailor_profile_id::text)
  )
  or is_my_tailor_profile(tailor_profile_id::text)
);

create policy "tailors insert own seller items"
on public.seller_items for insert to authenticated
with check (is_my_tailor_profile(tailor_profile_id::text));

create policy "tailors update own seller items"
on public.seller_items for update to authenticated
using (is_my_tailor_profile(tailor_profile_id::text))
with check (is_my_tailor_profile(tailor_profile_id::text));

create policy "tailors delete own seller items"
on public.seller_items for delete to authenticated
using (is_my_tailor_profile(tailor_profile_id::text));

alter policy "customers: manage own saved tailors"
on public.saved_tailors
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter policy "tailors: own diary"
on public.diary_entries
to authenticated
using (tailor_id = (select auth.uid()))
with check (tailor_id = (select auth.uid()));

alter policy "communication_preferences_own_read"
on public.communication_preferences
to authenticated
using (user_id = (select auth.uid()));

alter policy "communication_consents_own_read"
on public.communication_consents
to authenticated
using (user_id = (select auth.uid()));
