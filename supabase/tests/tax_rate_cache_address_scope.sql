begin;

do $test$
declare
  v_now timestamptz := now();
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tax_rate_cache'
      and column_name = 'address_key'
      and is_nullable = 'YES'
  ) then
    raise exception 'address_key is still nullable';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tax_rate_cache'::regclass
      and contype = 'p'
      and conname = 'tax_rate_cache_pkey'
  ) then
    raise exception 'address-scoped primary key is missing';
  end if;

  insert into public.tax_rate_cache (
    country_code, address_key, postal_code, rate_bps, tax_region, source, expires_at
  ) values
    ('US', '100 CONGRESS AVENUE AUSTIN TX 78701 US', '78701', 825, 'TX', 'ZIPTAX', v_now + interval '1 day'),
    ('US', '200 CONGRESS AVENUE AUSTIN TX 78701 US', '78701', 825, 'TX', 'ZIPTAX', v_now + interval '1 day');

  if (
    select count(*)
    from public.tax_rate_cache
    where country_code = 'US'
      and postal_code = '78701'
      and address_key is not null
  ) < 2 then
    raise exception 'two addresses in one ZIP did not retain separate cache rows';
  end if;

  begin
    insert into public.tax_rate_cache (
      country_code, address_key, postal_code, rate_bps, tax_region, source, expires_at
    ) values (
      'US', '100 CONGRESS AVENUE AUSTIN TX 78701 US', '78701', 900, 'TX', 'ZIPTAX', v_now + interval '1 day'
    );
    raise exception 'duplicate address cache key was accepted';
  exception
    when unique_violation then null;
  end;

  raise notice 'PASS: tax cache has an address-scoped primary key and same-ZIP addresses remain distinct';
end;
$test$;

rollback;
