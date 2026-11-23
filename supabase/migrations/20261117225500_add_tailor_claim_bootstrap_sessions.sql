-- Short-lived placeholder sessions used only by the claim coordinator.
-- STAFF_DRAFT JWTs remain inert everywhere else through a restrictive RLS
-- policy and the shared Edge auth guard.

create table public.tailor_claim_bootstrap_sessions (
  id uuid primary key,
  invite_id uuid not null references public.tailor_claim_invites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'PREPARING'
    check (status in ('PREPARING', 'ACTIVE', 'FAILED', 'EXPIRED', 'CONSUMED')),
  auth_session_id uuid,
  expires_at timestamptz not null,
  activated_at timestamptz,
  completed_at timestamptz,
  failure_code text check (failure_code is null or char_length(failure_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at <= created_at + interval '10 minutes 5 seconds'),
  check ((status = 'ACTIVE') = (activated_at is not null)),
  check ((status in ('FAILED', 'EXPIRED', 'CONSUMED')) = (completed_at is not null))
);

create unique index tailor_claim_bootstrap_one_open_per_invite_idx
  on public.tailor_claim_bootstrap_sessions(invite_id)
  where status in ('PREPARING', 'ACTIVE');
create unique index tailor_claim_bootstrap_auth_session_idx
  on public.tailor_claim_bootstrap_sessions(auth_session_id)
  where auth_session_id is not null;
create index tailor_claim_bootstrap_expiry_idx
  on public.tailor_claim_bootstrap_sessions(status, expires_at)
  where status in ('PREPARING', 'ACTIVE');

alter table public.tailor_claim_bootstrap_sessions enable row level security;
revoke all on public.tailor_claim_bootstrap_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.tailor_claim_bootstrap_sessions to service_role;

create or replace function public.prepare_tailor_claim_bootstrap_session(
  p_token_hash text,
  p_email_hash text,
  p_code_hash text,
  p_session_id uuid
) returns table(result text, invite_id uuid, user_id uuid, placeholder_email text, expires_at timestamptz)
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_path public.tailor_claim_email_paths%rowtype;
  v_code public.tailor_claim_email_codes%rowtype;
  v_existing public.tailor_claim_bootstrap_sessions%rowtype;
begin
  if length(coalesce(p_token_hash, '')) <> 43
     or length(coalesce(p_email_hash, '')) <> 43
     or length(coalesce(p_code_hash, '')) <> 43
     or p_session_id is null then
    result := 'UNAVAILABLE'; return next; return;
  end if;

  select * into v_invite from public.tailor_claim_invites
  where token_hash = p_token_hash for update;
  if not found or v_invite.status not in ('INVITED', 'OPENED')
     or v_invite.expires_at is null or v_invite.expires_at <= now() then
    result := 'UNAVAILABLE'; return next; return;
  end if;

  select * into v_path from public.tailor_claim_email_paths
  where public.tailor_claim_email_paths.invite_id = v_invite.id for update;
  if found and v_path.locked_at is not null then
    result := 'EMAIL_LOCKED'; invite_id := v_invite.id; return next; return;
  end if;

  select * into v_code from public.tailor_claim_email_codes
  where public.tailor_claim_email_codes.invite_id = v_invite.id
    and email_hash = p_email_hash
    and code_hash = p_code_hash
    and status = 'VERIFIED'
  order by verified_at desc limit 1 for update;
  if not found or v_code.verified_at < now() - interval '15 minutes' then
    result := 'EMAIL_VERIFICATION_REQUIRED'; invite_id := v_invite.id; return next; return;
  end if;

  update public.tailor_claim_bootstrap_sessions
  set status = 'EXPIRED', completed_at = now(), updated_at = now()
  where public.tailor_claim_bootstrap_sessions.invite_id = v_invite.id
    and public.tailor_claim_bootstrap_sessions.status in ('PREPARING', 'ACTIVE')
    and public.tailor_claim_bootstrap_sessions.expires_at <= now();

  select * into v_existing from public.tailor_claim_bootstrap_sessions
  where public.tailor_claim_bootstrap_sessions.invite_id = v_invite.id
    and public.tailor_claim_bootstrap_sessions.status in ('PREPARING', 'ACTIVE')
  order by created_at desc limit 1 for update;
  if found then
    result := 'SESSION_EXISTS'; invite_id := v_invite.id; user_id := v_invite.tailor_user_id;
    expires_at := v_existing.expires_at; return next; return;
  end if;

  insert into public.tailor_claim_bootstrap_sessions(id, invite_id, user_id, expires_at)
  values (p_session_id, v_invite.id, v_invite.tailor_user_id, now() + interval '10 minutes')
  returning public.tailor_claim_bootstrap_sessions.expires_at into expires_at;

  select au.email into placeholder_email from auth.users au where au.id = v_invite.tailor_user_id;
  if placeholder_email is null or placeholder_email !~ '@claim[.]drapeon[.]invalid$' then
    update public.tailor_claim_bootstrap_sessions
      set status = 'FAILED', failure_code = 'PLACEHOLDER_IDENTITY_INVALID', completed_at = now(), updated_at = now()
    where public.tailor_claim_bootstrap_sessions.id = p_session_id;
    result := 'UNAVAILABLE'; invite_id := v_invite.id; return next; return;
  end if;

  result := 'PREPARED'; invite_id := v_invite.id; user_id := v_invite.tailor_user_id;
  return next;
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
    and status = 'PREPARING' and expires_at > now();
  return found;
end;
$$;

create or replace function public.fail_tailor_claim_bootstrap_session(
  p_session_id uuid,
  p_failure_code text
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.tailor_claim_bootstrap_sessions
  set status = 'FAILED', failure_code = coalesce(nullif(left(p_failure_code, 80), ''), 'BOOTSTRAP_FAILED'),
      completed_at = now(), updated_at = now()
  where id = p_session_id and status = 'PREPARING';
  return found;
end;
$$;

create or replace function public.is_staff_draft_identity()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'account_origin', '') = 'STAFF_DRAFT'
$$;

create or replace function public.is_active_tailor_claim_bootstrap_session()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_staff_draft_identity()
    and exists (
      select 1 from public.tailor_claim_bootstrap_sessions s
      where s.id = nullif(auth.jwt() -> 'app_metadata' ->> 'claim_session_id', '')::uuid
        and s.user_id = auth.uid()
        and s.auth_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.status = 'ACTIVE'
        and s.expires_at > now()
    )
$$;

revoke all on function public.prepare_tailor_claim_bootstrap_session(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.activate_tailor_claim_bootstrap_session(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_tailor_claim_bootstrap_session(uuid, text) from public, anon, authenticated;
revoke all on function public.is_staff_draft_identity() from public, anon;
revoke all on function public.is_active_tailor_claim_bootstrap_session() from public, anon;
grant execute on function public.prepare_tailor_claim_bootstrap_session(text, text, text, uuid) to service_role;
grant execute on function public.activate_tailor_claim_bootstrap_session(uuid, uuid, uuid) to service_role;
grant execute on function public.fail_tailor_claim_bootstrap_session(uuid, text) to service_role;
grant execute on function public.is_staff_draft_identity() to authenticated, service_role;
grant execute on function public.is_active_tailor_claim_bootstrap_session() to authenticated, service_role;

-- Restrictive policies are ANDed with every existing permissive policy. This
-- makes an authenticated STAFF_DRAFT JWT inert on all current RLS-protected
-- application and storage tables, while service-role claim orchestration keeps
-- its explicit access.
do $policy$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and c.relrowsecurity
      and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format('drop policy if exists deny_staff_draft_claim_session on %I.%I', target.schema_name, target.table_name);
    execute format(
      'create policy deny_staff_draft_claim_session on %I.%I as restrictive for all to authenticated using (not public.is_staff_draft_identity()) with check (not public.is_staff_draft_identity())',
      target.schema_name,
      target.table_name
    );
  end loop;
end
$policy$;

comment on table public.tailor_claim_bootstrap_sessions is
  'Short-lived claim coordinator sessions. Their JWTs are denied by normal RLS and Edge auth paths.';
comment on function public.is_staff_draft_identity() is
  'Canonical RLS deny helper for server-controlled STAFF_DRAFT app metadata.';
comment on function public.is_active_tailor_claim_bootstrap_session() is
  'Validates the server-controlled claim_session_id and Auth session_id for claim-only Edge actions.';
