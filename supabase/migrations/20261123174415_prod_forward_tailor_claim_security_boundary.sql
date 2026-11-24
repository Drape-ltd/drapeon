-- Production-forward STAFF_DRAFT boundary and terminal-provider cleanup.
-- This migration runs after the claim receipt tables exist. It stamps the
-- restrictive policy dynamically on every current public RLS table, avoiding
-- a hard-coded table list that can drift as Production evolves.

create or replace function public.clear_tailor_claim_placeholder_provider_identities(
  p_user_id uuid
) returns integer
language plpgsql security definer set search_path = auth, pg_temp as $$
declare v_deleted integer;
begin
  delete from auth.identities where user_id = p_user_id and provider <> 'email';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.clear_tailor_claim_placeholder_provider_identities(uuid) from public, anon, authenticated;
grant execute on function public.clear_tailor_claim_placeholder_provider_identities(uuid) to service_role;

create or replace function public.cleanup_terminal_tailor_claim_provider_identity()
returns trigger language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_handover_exists boolean := false;
begin
  if to_regclass('public.tailor_claim_transition_receipts') is not null then
    execute
      'select exists (
        select 1 from public.tailor_claim_transition_receipts
        where bootstrap_session_id = $1 and auth_handover_at is not null
      )'
    into v_handover_exists using new.id;
  end if;
  if new.status in ('FAILED', 'EXPIRED') and not v_handover_exists then
    perform public.clear_tailor_claim_placeholder_provider_identities(new.user_id);
  end if;
  return new;
end;
$$;
drop trigger if exists cleanup_terminal_tailor_claim_provider_identity on public.tailor_claim_bootstrap_sessions;
create trigger cleanup_terminal_tailor_claim_provider_identity
after update of status on public.tailor_claim_bootstrap_sessions
for each row when (old.status is distinct from new.status)
execute function public.cleanup_terminal_tailor_claim_provider_identity();

-- The hook uses a deliberately empty allowlist: a STAFF_DRAFT session may
-- reach only claim Edge Actions, never PostgREST, GraphQL, views or RPCs.
create or replace function public.reject_staff_draft_data_api_request()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_request_path text := coalesce(current_setting('request.path', true), '');
  v_allowlist constant text[] := array[]::text[];
begin
  if public.is_staff_draft_identity()
     and not (v_request_path = any(v_allowlist)) then
    raise insufficient_privilege using
      message = 'STAFF_DRAFT_SESSION_DENIED',
      detail = 'Claim bootstrap sessions cannot use the Data API.';
  end if;
end;
$$;
revoke all on function public.reject_staff_draft_data_api_request() from public;
grant execute on function public.reject_staff_draft_data_api_request() to authenticator, anon, authenticated, service_role;
alter role authenticator set pgrst.db_pre_request = 'public.reject_staff_draft_data_api_request';
notify pgrst, 'reload config';

-- PostgREST does not guard Realtime authorization. Preserve the second layer
-- there, then enumerate every RLS-enabled public table from the live catalog.
drop policy if exists deny_staff_draft_claim_session on realtime.messages;
create policy deny_staff_draft_claim_session on realtime.messages
  as restrictive for all to authenticated
  using (not (select public.is_staff_draft_identity()))
  with check (not (select public.is_staff_draft_identity()));

do $policy$
declare target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    execute format('drop policy if exists deny_staff_draft_claim_session on %I.%I', target.schema_name, target.table_name);
    execute format(
      'create policy deny_staff_draft_claim_session on %I.%I as restrictive for all to authenticated using (not (select public.is_staff_draft_identity())) with check (not (select public.is_staff_draft_identity()))',
      target.schema_name, target.table_name
    );
  end loop;
end
$policy$;

-- The contract gate below reuses this catalog query on every release, so new
-- RLS tables cannot reach Production without the restrictive policy.
do $coverage$
declare v_missing text;
begin
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ' order by n.nspname, c.relname)
    into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
    and not exists (
      select 1
      from pg_policy p
      where p.polrelid = c.oid
        and p.polname = 'deny_staff_draft_claim_session'
        and pg_get_expr(p.polqual, p.polrelid) ~* 'not[[:space:]]*[(][[:space:]]*select[[:space:]]+(public[.])?is_staff_draft_identity[(][)]'
        and pg_get_expr(p.polwithcheck, p.polrelid) ~* 'not[[:space:]]*[(][[:space:]]*select[[:space:]]+(public[.])?is_staff_draft_identity[(][)]'
    );
  if v_missing is not null then
    raise exception 'STAFF_DRAFT policy coverage missing or not initPlan-wrapped: %', v_missing;
  end if;
end
$coverage$;

create or replace function public.rebind_tailor_claim_bootstrap_auth_session(
  p_bootstrap_session_id uuid,p_user_id uuid,p_old_auth_session_id uuid,p_new_auth_session_id uuid
) returns boolean
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_bootstrap public.tailor_claim_bootstrap_sessions%rowtype;
  v_identity_count integer;
begin
  select * into v_bootstrap
  from public.tailor_claim_bootstrap_sessions
  where id = p_bootstrap_session_id and user_id = p_user_id
    and auth_session_id = p_old_auth_session_id and status = 'ACTIVE'
    and expires_at > now()
  for update;
  if not found then return false; end if;

  select count(*) into v_identity_count from auth.identities identity
  where identity.user_id = p_user_id and identity.provider <> 'email';
  if v_bootstrap.provider is null then
    if v_identity_count <> 0 then return false; end if;
  elsif v_identity_count <> 1 or not exists (
    select 1 from auth.identities identity
    where identity.user_id = p_user_id
      and identity.provider = v_bootstrap.provider
      and identity.provider_id = v_bootstrap.provider_subject
  ) then return false;
  end if;
  update public.tailor_claim_bootstrap_sessions
  set auth_session_id = p_new_auth_session_id, updated_at = now()
  where id = v_bootstrap.id;
  insert into public.audit_logs(actor_id, actor_role, event, severity, payload)
  values (
    p_user_id::text, 'TAILOR', 'tailor_claim.auth_session_rebound', 'info',
    jsonb_build_object('invite_id', v_bootstrap.invite_id, 'bootstrap_session_id', p_bootstrap_session_id)
  );
  return true;
end;
$$;
revoke all on function public.rebind_tailor_claim_bootstrap_auth_session(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.rebind_tailor_claim_bootstrap_auth_session(uuid,uuid,uuid,uuid) to service_role;
