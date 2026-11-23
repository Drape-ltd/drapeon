-- Restore the original service-role table access and RLS-disabled state.
revoke all on table public.tax_rate_cache from public, anon, authenticated, service_role;
grant all on table public.tax_rate_cache to service_role;
alter table public.tax_rate_cache disable row level security;
comment on table public.tax_rate_cache is null;
