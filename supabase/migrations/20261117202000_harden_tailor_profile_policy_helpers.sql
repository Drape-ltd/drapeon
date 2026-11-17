-- Owner-only tailor profile fields must not be granted to every signed-in
-- customer merely because dependent-table RLS policies need to inspect them.
-- Keep those policy checks inside narrow, boolean-only SECURITY DEFINER helpers.

create or replace function public.is_my_tailor_profile(p_tailor_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tailor_profiles tp
    where tp.id = p_tailor_profile_id
      and tp.user_id::text = (select auth.uid())::text
  );
$$;

create or replace function public.is_public_tailor_profile(p_tailor_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tailor_profiles tp
    where tp.id = p_tailor_profile_id
      and tp.is_live
      and tp.is_verified
      and not tp.is_test_profile
      and tp.lifecycle_state = 'LIVE'
  );
$$;

revoke all on function public.is_my_tailor_profile(text) from public, anon;
revoke all on function public.is_public_tailor_profile(text) from public;
grant execute on function public.is_my_tailor_profile(text) to authenticated;
grant execute on function public.is_public_tailor_profile(text) to anon, authenticated;

drop policy if exists "public: view live portfolio" on public.portfolio_items;
create policy "public: view live portfolio"
  on public.portfolio_items for select
  to anon, authenticated
  using (public.is_public_tailor_profile(tailor_profile_id));

drop policy if exists "tailor: own portfolio" on public.portfolio_items;
create policy "tailor: own portfolio"
  on public.portfolio_items for all
  to authenticated
  using (public.is_my_tailor_profile(tailor_profile_id))
  with check (public.is_my_tailor_profile(tailor_profile_id));

drop policy if exists "Public views portfolio of live tailors" on public.portfolio_photos;
drop policy if exists "public: read portfolio photos" on public.portfolio_photos;
create policy "public: read public portfolio photos"
  on public.portfolio_photos for select
  to anon, authenticated
  using (public.is_public_tailor_profile(tailor_profile_id));

drop policy if exists "tailors: manage own portfolio photos" on public.portfolio_photos;
create policy "tailors: manage own portfolio photos"
  on public.portfolio_photos for all
  to authenticated
  using (public.is_my_tailor_profile(tailor_profile_id))
  with check (public.is_my_tailor_profile(tailor_profile_id));

drop policy if exists "public reads live seller items" on public.seller_items;
create policy "public reads live seller items"
  on public.seller_items for select
  to anon, authenticated
  using (is_live and public.is_public_tailor_profile(tailor_profile_id));

drop policy if exists "tailors manage own seller items" on public.seller_items;
create policy "tailors manage own seller items"
  on public.seller_items for all
  to authenticated
  using (public.is_my_tailor_profile(tailor_profile_id))
  with check (public.is_my_tailor_profile(tailor_profile_id));
