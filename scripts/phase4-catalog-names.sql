-- Collect immediately before a Production promotion. Names only; no rows or bodies.
begin transaction read only;
select jsonb_build_object(
  'tables', (
    select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
    from (
      select distinct c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'payment_internal')
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
    ) names
  ),
  'rpcs', (
    select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
    from (
      select distinct p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'payment_internal')
    ) names
  ),
  'buckets', (
    select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
    from storage.buckets
  )
) as catalog_names;
rollback;
