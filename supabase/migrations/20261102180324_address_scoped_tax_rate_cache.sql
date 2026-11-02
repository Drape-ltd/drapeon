alter table public.tax_rate_cache
  add column if not exists address_key text;

alter table public.tax_rate_cache
  drop constraint if exists tax_rate_cache_pkey;

alter table public.tax_rate_cache
  add constraint tax_rate_cache_address_key_not_blank
  check (address_key is null or length(btrim(address_key)) > 0);

create unique index if not exists tax_rate_cache_country_address_key_uidx
  on public.tax_rate_cache (country_code, address_key);

create index if not exists tax_rate_cache_country_postal_code_idx
  on public.tax_rate_cache (country_code, postal_code);

comment on column public.tax_rate_cache.address_key is
  'Versioned normalized structured delivery address. NULL identifies legacy ZIP-scoped rows that must never satisfy an address lookup.';
