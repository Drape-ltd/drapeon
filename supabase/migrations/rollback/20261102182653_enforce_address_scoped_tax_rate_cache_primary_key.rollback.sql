alter table public.tax_rate_cache
  drop constraint if exists tax_rate_cache_pkey,
  alter column address_key drop not null;

create unique index if not exists tax_rate_cache_country_address_key_uidx
  on public.tax_rate_cache (country_code, address_key);
