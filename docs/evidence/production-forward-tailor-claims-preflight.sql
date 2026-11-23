-- Read-only Production preflight. Run with a transaction that cannot write.
-- Any unexpected row is a stop condition; do not substitute broad db push.

with targets(tablename) as (
  values ('tailor_profiles'::text), ('portfolio_photos'::text),
         ('portfolio_items'::text), ('seller_items'::text)
)
select
  'policy' as kind,
  p.tablename as object_name,
  p.policyname as subobject_name,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check
from pg_policies p
join targets t using (tablename)
where p.schemaname = 'public'
union all
select
  'function',
  'is_public_tailor_profile(text)',
  null,
  null,
  null,
  null,
  pg_get_functiondef('public.is_public_tailor_profile(text)'::regprocedure),
  null
order by kind, object_name, subobject_name;

-- The migration must not overwrite an unrelated existing request hook.
select
  setrole::regrole::text as role_name,
  setconfig
from pg_db_role_setting
where setrole = 'authenticator'::regrole;

-- Stop rather than replacing an unrelated PostgREST request hook. The planned
-- claim hook is allowed only when it is already this exact value or absent.
do $$
declare
  v_unexpected_hook text;
begin
  select setting
    into v_unexpected_hook
  from pg_db_role_setting r
  cross join lateral unnest(coalesce(r.setconfig, array[]::text[])) as setting
  where r.setrole = 'authenticator'::regrole
    and setting like 'pgrst.db_pre_request=%'
    and setting <> 'pgrst.db_pre_request=public.reject_staff_draft_data_api_request'
  limit 1;

  if v_unexpected_hook is not null then
    raise exception 'Unexpected authenticator PostgREST pre-request hook: %', v_unexpected_hook;
  end if;
end
$$;

-- The expected forward versions must all be absent before an approved apply.
select v.version, exists (
  select 1 from supabase_migrations.schema_migrations m where m.version = v.version
) as recorded
from (values
  ('20261123174412'), ('20261123174413'), ('20261123174414'),
  ('20261123174415'), ('20261123174416')
) as v(version)
order by v.version;

-- Exact prerequisite checks: Production shape only, no data reads.
select n.nspname, c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (n.nspname, c.relname) in (
  ('public','tailor_profiles'), ('public','users'),
  ('public','tailor_pickup_details'), ('public','media_assets'),
  ('public','audit_logs'), ('public','portfolio_photos'),
  ('public','portfolio_items'), ('public','seller_items'),
  ('public','ops_workforce_principals'), ('storage','buckets')
)
order by n.nspname, c.relname;

select a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) as type
from pg_attribute a
where a.attrelid = 'public.tailor_profiles'::regclass
  and a.attname in ('id','lifecycle_state') and a.attnum > 0 and not a.attisdropped
order by a.attname;

select extname from pg_extension where extname in ('pg_cron','pgcrypto') order by extname;
select to_regprocedure('util.invoke_edge_function(text,jsonb,integer)') as purge_invoker;
