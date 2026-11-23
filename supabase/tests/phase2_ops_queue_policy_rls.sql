begin;

do $$
declare
  v_table text;
  v_oid oid;
begin
  foreach v_table in array array['ops_coverage_calendars', 'ops_queue_policies'] loop
    v_oid := format('public.%I', v_table)::regclass;

    if not (select relrowsecurity from pg_class where oid = v_oid) then
      raise exception '% must have RLS enabled', v_table;
    end if;

    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_table
    ) then
      raise exception '% must not expose client row policies', v_table;
    end if;

    if has_table_privilege('anon', v_oid, 'select')
      or has_table_privilege('anon', v_oid, 'insert')
      or has_table_privilege('anon', v_oid, 'update')
      or has_table_privilege('authenticated', v_oid, 'select')
      or has_table_privilege('authenticated', v_oid, 'insert')
      or has_table_privilege('authenticated', v_oid, 'update') then
      raise exception 'publishable roles must not access %', v_table;
    end if;

    if not has_table_privilege('service_role', v_oid, 'select') then
      raise exception 'service_role must retain server-side read access to %', v_table;
    end if;
  end loop;
end;
$$;

rollback;
