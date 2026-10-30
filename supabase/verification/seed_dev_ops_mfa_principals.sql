-- Manual Dev-only seed. Never include this file in a migration batch.
-- Preflight: public.current_ops_environment() must be DEVELOPMENT and the
-- runtime configuration project_ref must be pqptfuqogvrajozfsqzi.
do $seed$
begin
  if not public.is_dev_ops_mfa_environment() then
    raise exception 'Refusing Dev QA principal seed outside Drape-DEV.';
  end if;

  insert into public.ops_workforce_principals(
    email,status,roles,permitted_environments,access_review_due_at,created_by
  )
  values(
    'founders+ops-qa@drapeon.co','ACTIVE',array['admin'],array['development'],
    now()+interval '30 days','DEV_QA_SUPABASE_MFA_MANUAL_SEED'
  )
  on conflict (lower(email)) do update set
    roles=array['admin'], permitted_environments=array['development'],
    access_review_due_at=greatest(public.ops_workforce_principals.access_review_due_at,now()+interval '30 days');
end $seed$;
