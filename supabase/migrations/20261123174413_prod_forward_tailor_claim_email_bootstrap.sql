-- Claim-owned email verification. Codes and addresses are represented only by
-- keyed/hash digests; the raw values exist only in the Edge request lifetime.
create table public.tailor_claim_email_paths (
  invite_id uuid primary key references public.tailor_claim_invites(id) on delete cascade,
  locked_at timestamptz,
  lock_reason text check (lock_reason in ('CODE_REQUEST_LIMIT', 'CODE_ATTEMPT_LIMIT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((locked_at is null and lock_reason is null) or (locked_at is not null and lock_reason is not null))
);

create table public.tailor_claim_email_codes (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.tailor_claim_invites(id) on delete cascade,
  email_hash text not null check (length(email_hash) = 43),
  code_hash text not null check (length(code_hash) = 43),
  status text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'EXPIRED', 'SUPERSEDED', 'LOCKED')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at <= created_at + interval '10 minutes 5 seconds'),
  check ((status = 'VERIFIED') = (verified_at is not null))
);

create index tailor_claim_email_codes_invite_created_idx
  on public.tailor_claim_email_codes(invite_id, created_at desc);

create table public.tailor_claim_email_jobs (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.tailor_claim_email_codes(id) on delete cascade,
  invite_id uuid not null references public.tailor_claim_invites(id) on delete cascade,
  email_hash text not null check (length(email_hash) = 43),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'FAILED')),
  provider text,
  provider_reference text,
  failure_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'PENDING') = (completed_at is null))
);

create unique index tailor_claim_email_jobs_code_idx
  on public.tailor_claim_email_jobs(code_id);

alter table public.tailor_claim_email_paths enable row level security;
alter table public.tailor_claim_email_codes enable row level security;
alter table public.tailor_claim_email_jobs enable row level security;
revoke all on public.tailor_claim_email_paths from public, anon, authenticated;
revoke all on public.tailor_claim_email_codes from public, anon, authenticated;
revoke all on public.tailor_claim_email_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.tailor_claim_email_paths to service_role;
grant select, insert, update, delete on public.tailor_claim_email_codes to service_role;
grant select, insert, update, delete on public.tailor_claim_email_jobs to service_role;

create or replace function public.issue_tailor_claim_email_code(
  p_token_hash text,
  p_email_hash text,
  p_code_hash text
) returns table(result text, invite_id uuid, code_id uuid, job_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_path public.tailor_claim_email_paths%rowtype;
  v_code_id uuid;
  v_job_id uuid;
  v_hour_count bigint;
  v_day_count bigint;
begin
  if length(coalesce(p_token_hash, '')) <> 43
     or length(coalesce(p_email_hash, '')) <> 43
     or length(coalesce(p_code_hash, '')) <> 43 then
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

  insert into public.tailor_claim_email_paths(invite_id)
  values (v_invite.id)
  on conflict (invite_id) do nothing;

  select * into v_path
  from public.tailor_claim_email_paths
  where public.tailor_claim_email_paths.invite_id = v_invite.id
  for update;

  if v_path.locked_at is not null then
    result := 'EMAIL_LOCKED'; invite_id := v_invite.id; return next; return;
  end if;

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '1 day')
    into v_hour_count, v_day_count
  from public.tailor_claim_email_codes
  where public.tailor_claim_email_codes.invite_id = v_invite.id;

  if v_hour_count >= 5 or v_day_count >= 10 then
    update public.tailor_claim_email_paths
      set locked_at = now(), lock_reason = 'CODE_REQUEST_LIMIT', updated_at = now()
    where public.tailor_claim_email_paths.invite_id = v_invite.id;
    result := 'EMAIL_LOCKED'; invite_id := v_invite.id; return next; return;
  end if;

  update public.tailor_claim_email_codes
    set status = case when expires_at <= now() then 'EXPIRED' else 'SUPERSEDED' end,
        updated_at = now()
  where public.tailor_claim_email_codes.invite_id = v_invite.id
    and status = 'PENDING';

  insert into public.tailor_claim_email_codes(invite_id, email_hash, code_hash, expires_at)
  values (v_invite.id, p_email_hash, p_code_hash, now() + interval '10 minutes')
  returning id into v_code_id;

  insert into public.tailor_claim_email_jobs(code_id, invite_id, email_hash)
  values (v_code_id, v_invite.id, p_email_hash)
  returning id into v_job_id;

  result := 'ISSUED'; invite_id := v_invite.id; code_id := v_code_id; job_id := v_job_id;
  return next;
end;
$$;

create or replace function public.record_tailor_claim_email_job_outcome(
  p_job_id uuid,
  p_accepted boolean,
  p_provider text default null,
  p_provider_reference text default null,
  p_failure_code text default null
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.tailor_claim_email_jobs
    set status = case when p_accepted then 'ACCEPTED' else 'FAILED' end,
        provider = case when p_accepted then nullif(left(p_provider, 40), '') else null end,
        provider_reference = case when p_accepted then nullif(left(p_provider_reference, 200), '') else null end,
        failure_code = case when p_accepted then null else coalesce(nullif(left(p_failure_code, 80), ''), 'PROVIDER_ERROR') end,
        completed_at = now()
  where id = p_job_id and status = 'PENDING';
  return found;
end;
$$;

create or replace function public.verify_tailor_claim_email_code(
  p_token_hash text,
  p_email_hash text,
  p_code_hash text
) returns table(result text, invite_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_path public.tailor_claim_email_paths%rowtype;
  v_code public.tailor_claim_email_codes%rowtype;
begin
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
    and email_hash = p_email_hash and status = 'PENDING'
  order by created_at desc limit 1 for update;

  if not found then result := 'INVALID_CODE'; invite_id := v_invite.id; return next; return; end if;
  if v_code.expires_at <= now() then
    update public.tailor_claim_email_codes set status = 'EXPIRED', updated_at = now() where id = v_code.id;
    result := 'CODE_EXPIRED'; invite_id := v_invite.id; return next; return;
  end if;
  if v_code.code_hash <> p_code_hash then
    update public.tailor_claim_email_codes
      set attempts = least(attempts + 1, 5),
          status = case when attempts + 1 >= 5 then 'LOCKED' else status end,
          updated_at = now()
    where id = v_code.id;
    if v_code.attempts + 1 >= 5 then
      insert into public.tailor_claim_email_paths(invite_id, locked_at, lock_reason)
      values (v_invite.id, now(), 'CODE_ATTEMPT_LIMIT')
      on conflict (invite_id) do update
        set locked_at = excluded.locked_at, lock_reason = excluded.lock_reason, updated_at = now();
      result := 'EMAIL_LOCKED';
    else
      result := 'INVALID_CODE';
    end if;
    invite_id := v_invite.id; return next; return;
  end if;

  update public.tailor_claim_email_codes
    set status = 'VERIFIED', verified_at = now(), updated_at = now()
  where id = v_code.id;
  result := 'VERIFIED'; invite_id := v_invite.id; return next;
end;
$$;

revoke all on function public.issue_tailor_claim_email_code(text, text, text) from public, anon, authenticated;
revoke all on function public.record_tailor_claim_email_job_outcome(uuid, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.verify_tailor_claim_email_code(text, text, text) from public, anon, authenticated;
grant execute on function public.issue_tailor_claim_email_code(text, text, text) to service_role;
grant execute on function public.record_tailor_claim_email_job_outcome(uuid, boolean, text, text, text) to service_role;
grant execute on function public.verify_tailor_claim_email_code(text, text, text) to service_role;

comment on table public.tailor_claim_email_codes is 'Claim-owned email codes; raw codes and addresses are never persisted.';
comment on table public.tailor_claim_email_jobs is 'Dedicated claim-email jobs. A recorded provider outcome is required before the client is told an email was sent.';
-- The RETURNS TABLE output name invite_id is also a PL/pgSQL variable. Refer
-- to the primary-key constraint explicitly so ON CONFLICT cannot bind to it.
create or replace function public.issue_tailor_claim_email_code(
  p_token_hash text,
  p_email_hash text,
  p_code_hash text
) returns table(result text, invite_id uuid, code_id uuid, job_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_path public.tailor_claim_email_paths%rowtype;
  v_code_id uuid;
  v_job_id uuid;
  v_hour_count bigint;
  v_day_count bigint;
begin
  if length(coalesce(p_token_hash, '')) <> 43
     or length(coalesce(p_email_hash, '')) <> 43
     or length(coalesce(p_code_hash, '')) <> 43 then
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

  insert into public.tailor_claim_email_paths(invite_id)
  values (v_invite.id)
  on conflict on constraint tailor_claim_email_paths_pkey do nothing;

  select * into v_path
  from public.tailor_claim_email_paths
  where public.tailor_claim_email_paths.invite_id = v_invite.id
  for update;

  if v_path.locked_at is not null then
    result := 'EMAIL_LOCKED'; invite_id := v_invite.id; return next; return;
  end if;

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '1 day')
    into v_hour_count, v_day_count
  from public.tailor_claim_email_codes
  where public.tailor_claim_email_codes.invite_id = v_invite.id;

  if v_hour_count >= 5 or v_day_count >= 10 then
    update public.tailor_claim_email_paths
      set locked_at = now(), lock_reason = 'CODE_REQUEST_LIMIT', updated_at = now()
    where public.tailor_claim_email_paths.invite_id = v_invite.id;
    result := 'EMAIL_LOCKED'; invite_id := v_invite.id; return next; return;
  end if;

  update public.tailor_claim_email_codes
    set status = case when expires_at <= now() then 'EXPIRED' else 'SUPERSEDED' end,
        updated_at = now()
  where public.tailor_claim_email_codes.invite_id = v_invite.id
    and status = 'PENDING';

  insert into public.tailor_claim_email_codes(invite_id, email_hash, code_hash, expires_at)
  values (v_invite.id, p_email_hash, p_code_hash, now() + interval '10 minutes')
  returning id into v_code_id;

  insert into public.tailor_claim_email_jobs(code_id, invite_id, email_hash)
  values (v_code_id, v_invite.id, p_email_hash)
  returning id into v_job_id;

  result := 'ISSUED'; invite_id := v_invite.id; code_id := v_code_id; job_id := v_job_id;
  return next;
end;
$$;

revoke all on function public.issue_tailor_claim_email_code(text, text, text) from public, anon, authenticated;
grant execute on function public.issue_tailor_claim_email_code(text, text, text) to service_role;
-- As in issuance, name the constraint explicitly so the RETURNS TABLE output
-- variable cannot shadow the invite_id column in the lock-path upsert.
create or replace function public.verify_tailor_claim_email_code(
  p_token_hash text,
  p_email_hash text,
  p_code_hash text
) returns table(result text, invite_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_path public.tailor_claim_email_paths%rowtype;
  v_code public.tailor_claim_email_codes%rowtype;
begin
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
    and email_hash = p_email_hash and status = 'PENDING'
  order by created_at desc limit 1 for update;

  if not found then result := 'INVALID_CODE'; invite_id := v_invite.id; return next; return; end if;
  if v_code.expires_at <= now() then
    update public.tailor_claim_email_codes set status = 'EXPIRED', updated_at = now() where id = v_code.id;
    result := 'CODE_EXPIRED'; invite_id := v_invite.id; return next; return;
  end if;
  if v_code.code_hash <> p_code_hash then
    update public.tailor_claim_email_codes
      set attempts = least(attempts + 1, 5),
          status = case when attempts + 1 >= 5 then 'LOCKED' else status end,
          updated_at = now()
    where id = v_code.id;
    if v_code.attempts + 1 >= 5 then
      insert into public.tailor_claim_email_paths(invite_id, locked_at, lock_reason)
      values (v_invite.id, now(), 'CODE_ATTEMPT_LIMIT')
      on conflict on constraint tailor_claim_email_paths_pkey do update
        set locked_at = excluded.locked_at, lock_reason = excluded.lock_reason, updated_at = now();
      result := 'EMAIL_LOCKED';
    else
      result := 'INVALID_CODE';
    end if;
    invite_id := v_invite.id; return next; return;
  end if;

  update public.tailor_claim_email_codes
    set status = 'VERIFIED', verified_at = now(), updated_at = now()
  where id = v_code.id;
  result := 'VERIFIED'; invite_id := v_invite.id; return next;
end;
$$;

revoke all on function public.verify_tailor_claim_email_code(text, text, text) from public, anon, authenticated;
grant execute on function public.verify_tailor_claim_email_code(text, text, text) to service_role;
create or replace function public.verify_tailor_claim_email_code(
  p_token_hash text,
  p_email text,
  p_email_hash text,
  p_code_hash text
) returns table(result text, invite_id uuid)
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_code public.tailor_claim_email_codes%rowtype;
begin
  if length(coalesce(p_email, '')) > 320
     or p_email is null
     or p_email <> lower(btrim(p_email)) then
    result := 'INVALID_CODE'; return next; return;
  end if;

  select * into v_invite
  from public.tailor_claim_invites
  where token_hash = p_token_hash
  for update;

  if found then
    select * into v_code
    from public.tailor_claim_email_codes
    where public.tailor_claim_email_codes.invite_id = v_invite.id
      and email_hash = p_email_hash
      and status = 'PENDING'
    order by created_at desc
    limit 1
    for update;
  end if;

  -- Only a holder of the current valid code receives a conflict result. This
  -- avoids turning the public action into an account-enumeration endpoint.
  if found and v_code.code_hash = p_code_hash and (
    exists (
      select 1 from auth.users au
      where lower(au.email) = p_email and au.id <> v_invite.tailor_user_id
    ) or exists (
      select 1 from public.users pu
      where lower(pu.email) = p_email and pu.id <> v_invite.tailor_user_id
    )
  ) then
    result := 'ACCOUNT_CONFLICT'; invite_id := v_invite.id; return next; return;
  end if;

  return query
    select verified.result, verified.invite_id
    from public.verify_tailor_claim_email_code(p_token_hash, p_email_hash, p_code_hash) verified;
end;
$$;

revoke all on function public.verify_tailor_claim_email_code(text, text, text, text) from public, anon, authenticated;
grant execute on function public.verify_tailor_claim_email_code(text, text, text, text) to service_role;
revoke all on function public.verify_tailor_claim_email_code(text, text, text) from service_role;

comment on function public.verify_tailor_claim_email_code(text, text, text, text) is
  'Verifies a claim-owned email code and rejects an existing non-placeholder account before any account mutation.';
create or replace function public.verify_tailor_claim_email_code(
  p_token_hash text,
  p_email text,
  p_email_hash text,
  p_code_hash text
) returns table(result text, invite_id uuid)
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_path public.tailor_claim_email_paths%rowtype;
  v_code public.tailor_claim_email_codes%rowtype;
begin
  if length(coalesce(p_email, '')) > 320
     or p_email is null
     or p_email <> lower(btrim(p_email)) then
    result := 'INVALID_CODE'; return next; return;
  end if;

  select * into v_invite
  from public.tailor_claim_invites
  where token_hash = p_token_hash
  for update;
  if not found or v_invite.status not in ('INVITED', 'OPENED')
     or v_invite.expires_at is null or v_invite.expires_at <= now() then
    result := 'UNAVAILABLE'; return next; return;
  end if;

  select * into v_path
  from public.tailor_claim_email_paths
  where public.tailor_claim_email_paths.invite_id = v_invite.id
  for update;
  if found and v_path.locked_at is not null then
    result := 'EMAIL_LOCKED'; invite_id := v_invite.id; return next; return;
  end if;

  select * into v_code
  from public.tailor_claim_email_codes
  where public.tailor_claim_email_codes.invite_id = v_invite.id
    and email_hash = p_email_hash and status = 'PENDING'
  order by created_at desc limit 1 for update;
  if not found then result := 'INVALID_CODE'; invite_id := v_invite.id; return next; return; end if;
  if v_code.expires_at <= now() then
    update public.tailor_claim_email_codes
      set status = 'EXPIRED', updated_at = now()
    where id = v_code.id;
    result := 'CODE_EXPIRED'; invite_id := v_invite.id; return next; return;
  end if;

  if v_code.code_hash <> p_code_hash then
    return query
      select checked.result, checked.invite_id
      from public.verify_tailor_claim_email_code(p_token_hash, p_email_hash, p_code_hash) checked;
    return;
  end if;

  -- Collision is deliberately last: invalid, revoked, expired, or locked
  -- capabilities must never reveal account existence.
  if exists (
    select 1 from auth.users au
    where au.email = p_email and au.id <> v_invite.tailor_user_id
  ) or exists (
    select 1 from public.users pu
    where pu.email = p_email and pu.id <> v_invite.tailor_user_id
  ) then
    result := 'ACCOUNT_CONFLICT'; invite_id := v_invite.id; return next; return;
  end if;

  update public.tailor_claim_email_codes
    set status = 'VERIFIED', verified_at = now(), updated_at = now()
  where id = v_code.id;
  result := 'VERIFIED'; invite_id := v_invite.id; return next;
end;
$$;

revoke all on function public.verify_tailor_claim_email_code(text, text, text, text) from public, anon, authenticated;
grant execute on function public.verify_tailor_claim_email_code(text, text, text, text) to service_role;

comment on function public.verify_tailor_claim_email_code(text, text, text, text) is
  'Applies invite, lock, and expiry gates before checking account collision and verifying a claim-owned email code.';
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
drop index if exists public.tailor_claim_bootstrap_verified_provider_subject_idx;
create unique index tailor_claim_bootstrap_verified_provider_subject_idx
  on public.tailor_claim_bootstrap_sessions(provider, provider_subject)
  where provider_subject is not null and status in ('PREPARING', 'ACTIVE');

comment on index public.tailor_claim_bootstrap_verified_provider_subject_idx is
  'Prevents concurrent active claims for one provider subject while allowing a failed, expired, or superseded proof to retry.';
