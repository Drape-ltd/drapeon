-- Local/Dev rollback for 20261118014508 only. It restores Production's
-- pre-helper dependent-table policies without changing any profile grants or
-- application data. Do not run this as a Production response: roll forward
-- with a reviewed correction instead.

drop policy if exists "public: view live portfolio" on public.portfolio_items;
create policy "public: view live portfolio"
  on public.portfolio_items for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.tailor_profiles tp
      where tp.id::text = portfolio_items.tailor_profile_id::text
        and tp.is_live
        and tp.is_verified
        and not tp.is_test_profile
    )
  );

drop policy if exists "tailor: own portfolio" on public.portfolio_items;
create policy "tailor: own portfolio"
  on public.portfolio_items for all
  to authenticated
  using (
    exists (
      select 1
      from public.tailor_profiles tp
      where tp.id::text = portfolio_items.tailor_profile_id::text
        and tp.user_id::text = (select auth.uid())::text
    )
  )
  with check (
    exists (
      select 1
      from public.tailor_profiles tp
      where tp.id::text = portfolio_items.tailor_profile_id::text
        and tp.user_id::text = (select auth.uid())::text
    )
  );

drop policy if exists "Public views portfolio of live tailors" on public.portfolio_photos;
drop policy if exists "public: read portfolio photos" on public.portfolio_photos;
drop policy if exists "public: read public portfolio photos" on public.portfolio_photos;
create policy "Public views portfolio of live tailors"
  on public.portfolio_photos for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.tailor_profiles tp
      where tp.id::text = portfolio_photos.tailor_profile_id::text
        and tp.is_live
        and tp.is_verified
        and not tp.is_test_profile
    )
  );

drop policy if exists "Tailor manages their portfolio" on public.portfolio_photos;
drop policy if exists "tailors: manage own portfolio photos" on public.portfolio_photos;
create policy "Tailor manages their portfolio"
  on public.portfolio_photos for all
  to authenticated
  using (
    exists (
      select 1
      from public.tailor_profiles tp
      where tp.id::text = portfolio_photos.tailor_profile_id::text
        and tp.user_id::text = (select auth.uid())::text
    )
  )
  with check (
    exists (
      select 1
      from public.tailor_profiles tp
      where tp.id::text = portfolio_photos.tailor_profile_id::text
        and tp.user_id::text = (select auth.uid())::text
    )
  );

drop policy if exists "public reads live seller items" on public.seller_items;
create policy "public reads live seller items"
  on public.seller_items for select
  to anon, authenticated
  using (
    is_live
    and exists (
      select 1
      from public.tailor_profiles tp
      where tp.id::text = seller_items.tailor_profile_id::text
        and tp.is_live
        and tp.is_verified
        and not tp.is_test_profile
    )
  );

drop policy if exists "tailors manage own seller items" on public.seller_items;
create policy "tailors manage own seller items"
  on public.seller_items for all
  to authenticated
  using (
    exists (
      select 1
      from public.tailor_profiles tp
      where tp.id::text = seller_items.tailor_profile_id::text
        and tp.user_id::text = (select auth.uid())::text
    )
  )
  with check (
    exists (
      select 1
      from public.tailor_profiles tp
      where tp.id::text = seller_items.tailor_profile_id::text
        and tp.user_id::text = (select auth.uid())::text
    )
  );

drop function if exists public.is_my_tailor_profile(text);
drop function if exists public.is_public_tailor_profile(text);
