-- Forward-only security repair. Do not restore a table-wide SELECT grant.
-- The forward migration only reasserts the catalogue's existing safe
-- column-level grants, so leaving it in place is the safe rollback posture.

grant select (
  id,
  display_name,
  business_name,
  avatar_url,
  location,
  availability,
  shop_paused,
  is_live
) on table public.tailor_profiles to anon, authenticated;
