-- Block STAFF_DRAFT bootstrap identities at the PostgREST boundary. The
-- allowlist is deliberately empty: claim coordination happens through Edge
-- Functions, never through the Data API, RPC, views, or GraphQL.
-- Terminal rows may retain their activation timestamp as audit evidence. The
-- original equivalence check made ACTIVE -> EXPIRED impossible.
alter table public.tailor_claim_bootstrap_sessions
  drop constraint tailor_claim_bootstrap_sessions_check1;
alter table public.tailor_claim_bootstrap_sessions
  add constraint tailor_claim_bootstrap_activation_state_check
  check (
    (status = 'ACTIVE' and activated_at is not null)
    or (status = 'PREPARING' and activated_at is null)
    or status in ('FAILED', 'EXPIRED', 'CONSUMED')
  );

create or replace function public.reject_staff_draft_data_api_request()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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

revoke all on function public.reject_staff_draft_data_api_request() from public, anon;
grant execute on function public.reject_staff_draft_data_api_request()
  to authenticator, authenticated, service_role;

alter role authenticator
  set pgrst.db_pre_request = 'public.reject_staff_draft_data_api_request';
notify pgrst, 'reload config';

-- Realtime authorization does not pass through PostgREST, so keep the same
-- identity inert on private channels through a restrictive policy.
drop policy if exists deny_staff_draft_claim_session on realtime.messages;
create policy deny_staff_draft_claim_session
  on realtime.messages
  as restrictive
  for all
  to authenticated
  using (not public.is_staff_draft_identity())
  with check (not public.is_staff_draft_identity());

-- Expired bootstrap sessions are re-locked in Auth and have every Auth
-- session revoked before the coordinator row is marked expired. The entire
-- operation is one database transaction and is service-role only.
create or replace function public.reap_expired_tailor_claim_bootstrap_sessions(
  p_limit integer default 25
) returns table(
  bootstrap_session_id uuid,
  invite_id uuid,
  user_id uuid,
  auth_sessions_revoked integer
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_row record;
  v_revoked integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'INVALID_REAPER_LIMIT' using errcode = '22023';
  end if;

  for v_row in
    select s.id, s.invite_id, s.user_id
    from public.tailor_claim_bootstrap_sessions s
    join public.tailor_claim_invites i on i.id = s.invite_id
    where s.status in ('PREPARING', 'ACTIVE')
      and s.expires_at <= now()
      and i.status in ('DRAFT', 'INVITED', 'OPENED')
    order by s.expires_at, s.id
    for update of s skip locked
    limit p_limit
  loop
    update auth.users
    set banned_until = greatest(
          coalesce(banned_until, '-infinity'::timestamptz),
          now() + interval '100 years'
        ),
        raw_app_meta_data = (coalesce(raw_app_meta_data, '{}'::jsonb) - 'claim_session_id')
          || jsonb_build_object('role', 'TAILOR', 'account_origin', 'STAFF_DRAFT')
    where id = v_row.user_id;

    if not found then
      raise exception 'BOOTSTRAP_PLACEHOLDER_NOT_FOUND';
    end if;

    delete from auth.sessions s where s.user_id = v_row.user_id;
    get diagnostics v_revoked = row_count;

    update public.tailor_claim_bootstrap_sessions
    set status = 'EXPIRED', activated_at = null, completed_at = now(), updated_at = now()
    where id = v_row.id;

    bootstrap_session_id := v_row.id;
    invite_id := v_row.invite_id;
    user_id := v_row.user_id;
    auth_sessions_revoked := v_revoked;
    return next;
  end loop;
end;
$$;

revoke all on function public.reap_expired_tailor_claim_bootstrap_sessions(integer)
  from public, anon, authenticated;
grant execute on function public.reap_expired_tailor_claim_bootstrap_sessions(integer)
  to service_role;

comment on function public.reject_staff_draft_data_api_request() is
  'PostgREST db_pre_request hook with an intentionally empty STAFF_DRAFT allowlist.';
comment on function public.reap_expired_tailor_claim_bootstrap_sessions(integer) is
  'Bounded service-role reaper that re-bans expired unclaimed placeholders and revokes Auth sessions.';
