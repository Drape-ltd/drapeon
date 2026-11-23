begin;

do $$
declare
  relation_oid oid := 'public.tax_rate_cache'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = relation_oid) then
    raise exception 'tax_rate_cache must have RLS enabled';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'tax_rate_cache'
  ) then
    raise exception 'tax_rate_cache must not expose row policies';
  end if;

  if has_table_privilege('anon', relation_oid, 'select')
    or has_table_privilege('anon', relation_oid, 'insert')
    or has_table_privilege('anon', relation_oid, 'update')
    or has_table_privilege('anon', relation_oid, 'delete')
    or has_table_privilege('authenticated', relation_oid, 'select')
    or has_table_privilege('authenticated', relation_oid, 'insert')
    or has_table_privilege('authenticated', relation_oid, 'update')
    or has_table_privilege('authenticated', relation_oid, 'delete') then
    raise exception 'publishable roles must not access tax_rate_cache';
  end if;

  if not has_table_privilege('service_role', relation_oid, 'select')
    or not has_table_privilege('service_role', relation_oid, 'insert')
    or not has_table_privilege('service_role', relation_oid, 'update') then
    raise exception 'service_role must retain cache read/upsert access';
  end if;

  if has_table_privilege('service_role', relation_oid, 'delete')
    or has_table_privilege('service_role', relation_oid, 'truncate') then
    raise exception 'service_role cache access should not include delete or truncate';
  end if;
end;
$$;

rollback;
