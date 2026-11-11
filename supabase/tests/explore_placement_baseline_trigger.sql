create trigger trg_guard_tailor_marketplace_category
  before insert or update on public.tailor_profiles
  for each row execute function public.guard_tailor_marketplace_category();
