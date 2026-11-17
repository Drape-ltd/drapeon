-- Restore the least-privilege catalogue contract after the Dev-only
-- table-level grant was identified as unsafe. RLS limits rows, while these
-- column grants limit the public response shape. Both are required.
--
-- The original public-catalogue failure was `permission denied for table
-- orders` while evaluating the shared-order profile policy. That policy is
-- corrected separately in 20261117171105. All eight columns below were
-- already individually granted by earlier migrations; they are reasserted
-- here so the intended public catalogue projection is explicit and durable.

revoke select on table public.tailor_profiles from anon, authenticated;

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
