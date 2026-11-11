-- Roll back address-scoped caching to the former ZIP-scoped shape.
-- Address-scoped rows can contain multiple entries for one country/ZIP, so
-- retain only the freshest row per country/ZIP before restoring the old key.
with ranked as (
  select ctid,
    row_number() over (
      partition by country_code, postal_code
      order by updated_at desc, created_at desc, address_key desc nulls last
    ) as position
  from public.tax_rate_cache
)
delete from public.tax_rate_cache target
using ranked
where target.ctid = ranked.ctid
  and ranked.position > 1;

alter table public.tax_rate_cache
  drop constraint if exists tax_rate_cache_pkey;

drop index if exists public.tax_rate_cache_country_address_key_uidx;
drop index if exists public.tax_rate_cache_country_postal_code_idx;

alter table public.tax_rate_cache
  drop constraint if exists tax_rate_cache_address_key_not_blank,
  drop column if exists address_key,
  add constraint tax_rate_cache_pkey primary key (country_code, postal_code);
