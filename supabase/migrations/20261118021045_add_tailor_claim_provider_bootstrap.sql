-- A bearer of the private, rate-limited invite may open the same inert
-- placeholder session before linking Apple or Google. This path deliberately
-- does not require the email channel, so an invite whose email-code path is
-- locked can still recover through a provider identity.
create or replace function public.prepare_tailor_claim_provider_bootstrap_session(
  p_token_hash text,
  p_session_id uuid
) returns table(
  result text,
  invite_id uuid,
  user_id uuid,
  placeholder_email text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_existing public.tailor_claim_bootstrap_sessions%rowtype;
begin
  if length(coalesce(p_token_hash, '')) <> 43 or p_session_id is null then
    result := 'UNAVAILABLE'; return next; return;
  end if;

  select * into v_invite
  from public.tailor_claim_invites
  where token_hash = p_token_hash
  for update;
  if not found or v_invite.status not in ('INVITED', 'OPENED')
     or v_invite.expires_at is null or v_invite.expires_at <= now() then
    result := 'UNAVAILABLE'; return next; return;
  end if;

  update public.tailor_claim_bootstrap_sessions
  set status = 'EXPIRED', completed_at = now(), updated_at = now()
  where public.tailor_claim_bootstrap_sessions.invite_id = v_invite.id
    and public.tailor_claim_bootstrap_sessions.status in ('PREPARING', 'ACTIVE')
    and public.tailor_claim_bootstrap_sessions.expires_at <= now();

  select * into v_existing
  from public.tailor_claim_bootstrap_sessions
  where public.tailor_claim_bootstrap_sessions.invite_id = v_invite.id
    and public.tailor_claim_bootstrap_sessions.status in ('PREPARING', 'ACTIVE')
  order by created_at desc
  limit 1
  for update;
  if found then
    result := 'SESSION_EXISTS';
    invite_id := v_invite.id;
    user_id := v_invite.tailor_user_id;
    expires_at := v_existing.expires_at;
    return next; return;
  end if;

  insert into public.tailor_claim_bootstrap_sessions(id, invite_id, user_id, expires_at)
  values (p_session_id, v_invite.id, v_invite.tailor_user_id, now() + interval '10 minutes')
  returning public.tailor_claim_bootstrap_sessions.expires_at into expires_at;

  select au.email into placeholder_email
  from auth.users au
  where au.id = v_invite.tailor_user_id;
  if placeholder_email is null or placeholder_email !~ '@claim[.]drapeon[.]invalid$' then
    update public.tailor_claim_bootstrap_sessions
    set status = 'FAILED', failure_code = 'PLACEHOLDER_IDENTITY_INVALID',
        completed_at = now(), updated_at = now()
    where id = p_session_id;
    result := 'UNAVAILABLE'; invite_id := v_invite.id; return next; return;
  end if;

  result := 'PREPARED';
  invite_id := v_invite.id;
  user_id := v_invite.tailor_user_id;
  return next;
end;
$$;

revoke all on function public.prepare_tailor_claim_provider_bootstrap_session(text, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_tailor_claim_provider_bootstrap_session(text, uuid)
  to service_role;

comment on function public.prepare_tailor_claim_provider_bootstrap_session(text, uuid) is
  'Prepares an inert placeholder session for Apple/Google claim linking without relying on the email-code channel.';
