delete from public.tax_rate_cache
where address_key is null;

alter table public.tax_rate_cache
  alter column address_key set not null;

drop index if exists public.tax_rate_cache_country_address_key_uidx;

alter table public.tax_rate_cache
  add constraint tax_rate_cache_pkey primary key (country_code, address_key);
