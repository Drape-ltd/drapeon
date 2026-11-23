-- Restore the trigger exactly as 20261110050000 created it.
drop trigger if exists trg_guard_tailor_marketplace_category on public.tailor_profiles;
create trigger trg_guard_tailor_marketplace_category
before insert or update of marketplace_category on public.tailor_profiles
for each row execute function public.guard_tailor_marketplace_category();
