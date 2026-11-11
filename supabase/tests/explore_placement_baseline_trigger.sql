-- Exactly as 20261110050000 created it (and as it is live on Dev).
create trigger trg_guard_tailor_marketplace_category
  before insert or update of marketplace_category on public.tailor_profiles
  for each row execute function public.guard_tailor_marketplace_category();
