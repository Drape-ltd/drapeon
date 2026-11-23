-- Keep claimed-but-not-finalized staff profiles out of the normal tailor app.
-- These profiles can satisfy legacy profile_completed checks before their
-- phone is verified and their private media is published.

drop function if exists public.get_my_tailor_profile_guard();

create function public.get_my_tailor_profile_guard()
returns table (
  id text,
  profile_completed boolean,
  display_name text,
  location text,
  id_verification_status text,
  avatar_url text,
  lifecycle_state text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    tp.id,
    tp.profile_completed,
    tp.display_name,
    tp.location,
    tp.id_verification_status,
    tp.avatar_url,
    tp.lifecycle_state::text
  from public.tailor_profiles as tp
  where tp.user_id::text = (select auth.uid())::text
  limit 1;
$$;

revoke all on function public.get_my_tailor_profile_guard() from public;
revoke all on function public.get_my_tailor_profile_guard() from anon;
grant execute on function public.get_my_tailor_profile_guard() to authenticated;
