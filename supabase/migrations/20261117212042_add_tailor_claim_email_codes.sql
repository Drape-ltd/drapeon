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
