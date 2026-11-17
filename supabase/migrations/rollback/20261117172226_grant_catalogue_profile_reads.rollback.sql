-- Rehearsal rollback only. Do not use in a shared environment while the public
-- catalogue still embeds tailor_profiles.
revoke select on table public.tailor_profiles from anon, authenticated;
