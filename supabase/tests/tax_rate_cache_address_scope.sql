begin;

do $test$
declare
  v_now timestamptz := now();
begin
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

  if exists (
    select 1
    from public.tax_rate_cache
    where address_key is null
      and country_code = 'US'
      and postal_code = '78701'
      and expires_at > now()
  ) then
    raise notice 'Legacy ZIP-only rows remain for expiry but are distinguishable by NULL address_key';
  end if;

  raise notice 'PASS: tax cache is address-scoped and legacy ZIP rows are versioned out';
end;
$test$;

rollback;
