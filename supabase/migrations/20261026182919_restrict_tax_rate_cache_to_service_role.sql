-- This cache is only read and upserted by Edge functions initialized with the
-- service-role client. Keep it outside all publishable-key access paths.
alter table public.tax_rate_cache enable row level security;

revoke all on table public.tax_rate_cache from public, anon, authenticated, service_role;
grant select, insert, update on table public.tax_rate_cache to service_role;

comment on table public.tax_rate_cache is
  'Service-role-only cache for resolved US/CA order tax rates; no client policies.';
