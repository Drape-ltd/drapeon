alter table public.tailor_claim_bootstrap_sessions
  add column provider text,
  add column provider_subject text,
  add column provider_nonce_hash text,
  add column provider_verified_at timestamptz,
  add constraint tailor_claim_bootstrap_provider_check check (
    provider is null or provider in ('apple', 'google')
  ),
  add constraint tailor_claim_bootstrap_provider_proof_check check (
    (provider is null and provider_subject is null and provider_nonce_hash is null and provider_verified_at is null)
    or (
      provider is not null
      and provider_nonce_hash ~ '^[0-9a-f]{64}$'
      and (provider_subject is null) = (provider_verified_at is null)
      and (provider_subject is null or char_length(provider_subject) between 1 and 255)
    )
  );

create unique index tailor_claim_bootstrap_verified_provider_subject_idx
  on public.tailor_claim_bootstrap_sessions(provider, provider_subject)
  where provider_subject is not null;

drop function public.prepare_tailor_claim_provider_bootstrap_session(text, uuid);

create function public.prepare_tailor_claim_provider_proof(
  p_token_hash text,
  p_provider text,
  p_nonce_hash text,
  p_session_id uuid
) returns table(
  result text,
  invite_id uuid,
  user_id uuid,
  expires_at timestamptz,
  superseded_sessions integer
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_existing record;
  v_superseded integer := 0;
begin
  if length(coalesce(p_token_hash, '')) <> 43
     or p_provider not in ('apple', 'google')
     or p_nonce_hash !~ '^[0-9a-f]{64}$'
     or p_session_id is null then
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

  for v_existing in
    select bootstrap.id, bootstrap.user_id
    from public.tailor_claim_bootstrap_sessions bootstrap
    where bootstrap.invite_id = v_invite.id
      and bootstrap.status in ('PREPARING', 'ACTIVE')
    order by bootstrap.created_at
    for update
  loop
    update auth.users
    set banned_until = greatest(
          coalesce(banned_until, '-infinity'::timestamptz),
          now() + interval '100 years'
        ),
        raw_app_meta_data = (coalesce(raw_app_meta_data, '{}'::jsonb) - 'claim_session_id')
          || jsonb_build_object('role', 'TAILOR', 'account_origin', 'STAFF_DRAFT')
    where auth.users.id = v_existing.user_id;
    delete from auth.sessions where auth.sessions.user_id = v_existing.user_id;
    update public.tailor_claim_bootstrap_sessions
    set status = 'EXPIRED', activated_at = null, completed_at = now(), updated_at = now(),
        failure_code = 'SUPERSEDED'
    where public.tailor_claim_bootstrap_sessions.id = v_existing.id;
    insert into public.audit_logs(actor_id, actor_role, event, severity, payload)
    values (
      v_existing.user_id::text,
      'TAILOR',
      'tailor_claim.bootstrap_session_superseded',
      'warn',
      jsonb_build_object('invite_id', v_invite.id, 'claim_session_id', v_existing.id)
    );
    v_superseded := v_superseded + 1;
  end loop;

  insert into public.tailor_claim_bootstrap_sessions(
    id, invite_id, user_id, provider, provider_nonce_hash, expires_at
  ) values (
    p_session_id, v_invite.id, v_invite.tailor_user_id, p_provider, p_nonce_hash,
    now() + interval '10 minutes'
  ) returning public.tailor_claim_bootstrap_sessions.expires_at into expires_at;

  result := 'PROOF_REQUIRED';
  invite_id := v_invite.id;
  user_id := v_invite.tailor_user_id;
  superseded_sessions := v_superseded;
  return next;
end;
$$;

create function public.record_tailor_claim_provider_proof(
  p_session_id uuid,
  p_provider text,
  p_provider_subject text
) returns table(result text, invite_id uuid, user_id uuid, placeholder_email text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_session public.tailor_claim_bootstrap_sessions%rowtype;
  v_email text;
begin
  if p_session_id is null or p_provider not in ('apple', 'google')
     or char_length(coalesce(p_provider_subject, '')) not between 1 and 255 then
    result := 'UNAVAILABLE'; return next; return;
  end if;

  select * into v_session
  from public.tailor_claim_bootstrap_sessions
  where id = p_session_id
  for update;
  if not found or v_session.status <> 'PREPARING' or v_session.expires_at <= now()
     or v_session.provider <> p_provider or v_session.provider_verified_at is not null then
    result := 'UNAVAILABLE'; return next; return;
  end if;

  if exists (
    select 1 from auth.identities identity
    where identity.provider = p_provider
      and identity.provider_id = p_provider_subject
      and identity.user_id <> v_session.user_id
  ) then
    update public.tailor_claim_bootstrap_sessions
    set status = 'FAILED', failure_code = 'ACCOUNT_CONFLICT',
        completed_at = now(), updated_at = now()
    where id = p_session_id;
    insert into public.audit_logs(actor_id, actor_role, event, severity, payload)
    values (
      v_session.user_id::text, 'TAILOR', 'tailor_claim.provider_account_conflict', 'warn',
      jsonb_build_object('invite_id', v_session.invite_id, 'claim_session_id', p_session_id, 'provider', p_provider)
    );
    result := 'ACCOUNT_CONFLICT'; invite_id := v_session.invite_id; user_id := v_session.user_id;
    return next; return;
  end if;

  select email into v_email from auth.users where id = v_session.user_id;
  if v_email is null or v_email !~ '@claim[.]drapeon[.]invalid$' then
    result := 'UNAVAILABLE'; return next; return;
  end if;

  update public.tailor_claim_bootstrap_sessions
  set provider_subject = p_provider_subject, provider_verified_at = now(), updated_at = now()
  where id = p_session_id;

  result := 'VERIFIED';
  invite_id := v_session.invite_id;
  user_id := v_session.user_id;
  placeholder_email := v_email;
  expires_at := v_session.expires_at;
  return next;
end;
$$;

create function public.fail_tailor_claim_provider_bootstrap_session(
  p_session_id uuid,
  p_failure_code text
) returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_session public.tailor_claim_bootstrap_sessions%rowtype;
begin
  select * into v_session
  from public.tailor_claim_bootstrap_sessions
  where id = p_session_id and status in ('PREPARING', 'ACTIVE')
  for update;
  if not found then return false; end if;

  update auth.users
  set banned_until = greatest(
        coalesce(banned_until, '-infinity'::timestamptz),
        now() + interval '100 years'
      ),
      raw_app_meta_data = (coalesce(raw_app_meta_data, '{}'::jsonb) - 'claim_session_id')
        || jsonb_build_object('role', 'TAILOR', 'account_origin', 'STAFF_DRAFT')
  where id = v_session.user_id;
  delete from auth.sessions where user_id = v_session.user_id;
  update public.tailor_claim_bootstrap_sessions
  set status = 'FAILED', activated_at = null,
      failure_code = coalesce(nullif(left(p_failure_code, 80), ''), 'PROVIDER_LINK_FAILED'),
      completed_at = now(), updated_at = now()
  where id = p_session_id;
  insert into public.audit_logs(actor_id, actor_role, event, severity, payload)
  values (
    v_session.user_id::text, 'TAILOR', 'tailor_claim.provider_bootstrap_failed', 'warn',
    jsonb_build_object(
      'invite_id', v_session.invite_id,
      'claim_session_id', p_session_id,
      'failure_code', coalesce(nullif(left(p_failure_code, 80), ''), 'PROVIDER_LINK_FAILED')
    )
  );
  return true;
end;
$$;

create or replace function public.activate_tailor_claim_bootstrap_session(
  p_session_id uuid,
  p_auth_session_id uuid,
  p_user_id uuid
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.tailor_claim_bootstrap_sessions
  set status = 'ACTIVE', auth_session_id = p_auth_session_id,
      activated_at = now(), updated_at = now()
  where id = p_session_id and user_id = p_user_id
    and status = 'PREPARING' and expires_at > now()
    and (provider is null or provider_verified_at is not null);
  return found;
end;
$$;

revoke all on function public.prepare_tailor_claim_provider_proof(text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.record_tailor_claim_provider_proof(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_tailor_claim_provider_bootstrap_session(uuid, text)
  from public, anon, authenticated;
grant execute on function public.prepare_tailor_claim_provider_proof(text, text, text, uuid)
  to service_role;
grant execute on function public.record_tailor_claim_provider_proof(uuid, text, text)
  to service_role;
grant execute on function public.fail_tailor_claim_provider_bootstrap_session(uuid, text)
  to service_role;

comment on function public.prepare_tailor_claim_provider_proof(text, text, text, uuid) is
  'Supersedes stale claim sessions and records a server nonce before any provider identity is accepted or Auth ban is lifted.';
comment on function public.record_tailor_claim_provider_proof(uuid, text, text) is
  'Stores a JWKS-verified provider subject only after checking auth.identities for an account collision.';
