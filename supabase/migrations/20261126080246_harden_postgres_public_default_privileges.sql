-- Fail closed before any further Phase 4 payment schema promotion.
-- This changes future objects owned by postgres. Existing object ACLs are
-- unchanged; each S-batch still revokes its new objects explicitly.
do $guard$
declare
  v_environment text;
  v_project_ref text;
begin
  select environment, project_ref
    into v_environment, v_project_ref
    from public.ops_runtime_configuration
   where singleton is true;

  if (v_environment, v_project_ref) not in
     (('DEVELOPMENT', 'pqptfuqogvrajozfsqzi'),
      ('PRODUCTION', 'wkfsrunetmgjdtcurmoj')) then
    raise exception 'PHASE4_DEFAULT_ACL_PROJECT_GUARD';
  end if;
end;
$guard$;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- PostgreSQL's built-in PUBLIC EXECUTE is a global default. A schema-scoped
-- REVOKE cannot remove it. The global revoke is required for new postgres-
-- owned functions in public to be non-callable by anon by default.
alter default privileges for role postgres
  revoke execute on functions from public;

-- supabase_admin owns a separate default ACL. A postgres-owned migration
-- cannot change it; explicit per-object revokes remain mandatory.
