-- Development-only PR 2, Stage 4 migration 3/5.
-- Provider identities are proof material, not a durable capability, until the
-- claim handover succeeds. A forwarded invite must never leave a provider
-- identity attached to the staff-created placeholder after a terminal attempt.

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

revoke all on function public.clear_tailor_claim_placeholder_provider_identities(uuid)
  from public, anon, authenticated;
grant execute on function public.clear_tailor_claim_placeholder_provider_identities(uuid)
  to service_role;

create or replace function public.cleanup_terminal_tailor_claim_provider_identity()
returns trigger
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_handover_exists boolean := false;
begin
  -- A handover receipt owns a verified provider identity and remains replayable.
  -- Every other terminal placeholder returns to STAFF_DRAFT with no provider ID.
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

drop trigger if exists cleanup_terminal_tailor_claim_provider_identity
  on public.tailor_claim_bootstrap_sessions;
create trigger cleanup_terminal_tailor_claim_provider_identity
  after update of status on public.tailor_claim_bootstrap_sessions
  for each row when (old.status is distinct from new.status)
  execute function public.cleanup_terminal_tailor_claim_provider_identity();

-- PostgREST changes into the request role before invoking the hook. The hook
-- itself returns immediately for ordinary sessions, but anon needs EXECUTE to
-- get there; STAFF_DRAFT denial remains inside the security-definer function.
revoke all on function public.reject_staff_draft_data_api_request() from public;
grant execute on function public.reject_staff_draft_data_api_request()
  to authenticator, anon, authenticated, service_role;

create or replace function public.rebind_tailor_claim_bootstrap_auth_session(
  p_bootstrap_session_id uuid,
  p_user_id uuid,
  p_old_auth_session_id uuid,
  p_new_auth_session_id uuid
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
  ) then
    return false;
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
