-- Security-preserving rollback to A1's explicit service_role table grant and no FK index.
-- Keep public/anon/authenticated revoked; never restore Production's unsafe default grants.
revoke insert on table public.marketplace_category_decisions from service_role;
grant select on table public.marketplace_category_decisions to service_role;
drop index if exists public.marketplace_category_decisions_profile_created_idx;
