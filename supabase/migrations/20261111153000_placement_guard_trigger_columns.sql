-- The Tailors-requires-custom-orders guard (20261111151000) lives in
-- guard_tailor_marketplace_category(), but its trigger only fired on
-- UPDATE OF marketplace_category. A seller turning custom orders off (or a
-- verification change) never reached the guard. Fire it on every column the
-- guard reads.
drop trigger if exists trg_guard_tailor_marketplace_category on public.tailor_profiles;
create trigger trg_guard_tailor_marketplace_category
before insert or update of marketplace_category, supports_custom_orders, is_verified on public.tailor_profiles
for each row execute function public.guard_tailor_marketplace_category();
