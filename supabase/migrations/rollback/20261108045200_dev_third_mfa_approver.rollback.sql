-- Remove only the third Dev QA email from the binding allowlist. Existing Auth
-- and workforce rows are intentionally retained for an explicit owner cleanup.
create or replace function public.bind_dev_ops_mfa_principal(p_auth_user_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_email text; v_principal_id uuid;
begin
  if not public.is_dev_ops_mfa_environment() then raise exception 'Local Supabase MFA is disabled outside the bound Dev project.'; end if;
  select lower(email) into v_email from auth.users where id=p_auth_user_id and email_confirmed_at is not null;
  if v_email not in ('founders@drapeon.co','founders+ops-qa@drapeon.co') then raise exception 'Auth user is not an approved Dev QA principal.'; end if;
  update public.ops_workforce_principals set auth_user_id=p_auth_user_id,updated_at=now()
  where email=v_email and status='ACTIVE' and 'development'=any(permitted_environments)
    and (auth_user_id is null or auth_user_id=p_auth_user_id)
  returning id into v_principal_id;
  if v_principal_id is null then raise exception 'Dev QA workforce principal is unavailable or already bound.'; end if;
  return v_principal_id;
end $$;

revoke all on function public.bind_dev_ops_mfa_principal(uuid) from public,anon,authenticated;
grant execute on function public.bind_dev_ops_mfa_principal(uuid) to service_role;
