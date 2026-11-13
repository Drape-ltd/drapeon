-- Temporary production-only founder TOTP step-up for tailor trust decisions.
--
-- Cloudflare Access remains the first factor and named workforce boundary. This
-- fallback only replaces the currently unavailable sensitive-app MFA prompt,
-- and it expires automatically after the Cloudflare owner account is expected
-- to be recoverable. Money movement, workforce administration, exports, and
-- every other sensitive action remain on the dedicated Cloudflare application.

alter table public.ops_workforce_principals
  add column if not exists auth_user_id uuid references auth.users(id) on delete restrict;

create unique index if not exists ops_workforce_principals_auth_user_unique
  on public.ops_workforce_principals(auth_user_id)
  where auth_user_id is not null;

create table if not exists public.ops_founder_trust_mfa_fallback (
  singleton boolean primary key default true check (singleton),
  project_ref text not null check (project_ref = 'wkfsrunetmgjdtcurmoj'),
  principal_id uuid not null unique references public.ops_workforce_principals(id) on delete restrict,
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  enabled boolean not null default true,
  reason text not null check (char_length(trim(reason)) between 16 and 500),
  enabled_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_founder_trust_mfa_fallback_window check (
    expires_at > enabled_at
    and expires_at <= timestamptz '2026-12-01 06:00:00+00'
  )
);

create table if not exists public.ops_founder_trust_mfa_events (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references public.ops_workforce_principals(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  issue_id uuid references public.ops_issues(id) on delete restrict,
  event_type text not null check (event_type in (
    'SIGN_IN_ATTEMPTED',
    'TOTP_ENROLLMENT_STARTED',
    'TOTP_VERIFICATION_ATTEMPTED',
    'TRUST_EVIDENCE_SERVED',
    'TRUST_DECISION_PREPARED'
  )),
  outcome text not null check (outcome in ('SUCCEEDED', 'FAILED')),
  reason_code text,
  correlation_id uuid not null default gen_random_uuid(),
  mfa_authenticated_at timestamptz,
  fallback_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (event_type, correlation_id)
);

create index if not exists ops_founder_trust_mfa_events_principal_created_idx
  on public.ops_founder_trust_mfa_events(principal_id, created_at desc);

create index if not exists ops_founder_trust_mfa_events_issue_created_idx
  on public.ops_founder_trust_mfa_events(issue_id, created_at desc)
  where issue_id is not null;

alter table public.ops_founder_trust_mfa_fallback enable row level security;
alter table public.ops_founder_trust_mfa_events enable row level security;

revoke all on table public.ops_founder_trust_mfa_fallback from public, anon, authenticated;
revoke all on table public.ops_founder_trust_mfa_events from public, anon, authenticated;
grant select on table public.ops_founder_trust_mfa_fallback to service_role;
grant select, insert on table public.ops_founder_trust_mfa_events to service_role;

drop trigger if exists trg_ops_founder_trust_mfa_fallback_updated_at
  on public.ops_founder_trust_mfa_fallback;
create trigger trg_ops_founder_trust_mfa_fallback_updated_at
before update on public.ops_founder_trust_mfa_fallback
for each row execute function public.set_updated_at();

create or replace function public.reject_ops_founder_trust_mfa_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Founder trust MFA events are append-only.' using errcode = '55000';
end;
$$;

revoke all on function public.reject_ops_founder_trust_mfa_event_mutation()
  from public, anon, authenticated;

drop trigger if exists trg_ops_founder_trust_mfa_events_immutable
  on public.ops_founder_trust_mfa_events;
create trigger trg_ops_founder_trust_mfa_events_immutable
before update or delete on public.ops_founder_trust_mfa_events
for each row execute function public.reject_ops_founder_trust_mfa_event_mutation();

create or replace function public.prepare_founder_mfa_trust_verification_decision(
  p_issue_id uuid,
  p_profile_id uuid,
  p_tailor_user_id uuid,
  p_decision text,
  p_reason text,
  p_rejection_code text,
  p_expected_record_version bigint,
  p_idempotency_key text,
  p_actor_principal_id uuid,
  p_actor_auth_user_id uuid,
  p_actor_label text,
  p_mfa_authenticated_at timestamptz,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fallback public.ops_founder_trust_mfa_fallback%rowtype;
  v_result jsonb;
begin
  select * into v_fallback
  from public.ops_founder_trust_mfa_fallback
  where singleton = true
    and enabled = true
    and project_ref = 'wkfsrunetmgjdtcurmoj'
    and expires_at > now()
  for share;

  if v_fallback.singleton is null
    or v_fallback.principal_id is distinct from p_actor_principal_id
    or v_fallback.auth_user_id is distinct from p_actor_auth_user_id
  then
    raise exception 'Temporary founder trust MFA is unavailable.' using errcode = '42501';
  end if;
  if public.current_ops_environment() <> 'PRODUCTION' then
    raise exception 'Temporary founder trust MFA is production-only.' using errcode = '42501';
  end if;
  if p_mfa_authenticated_at is null
    or p_mfa_authenticated_at < v_fallback.enabled_at
    or p_mfa_authenticated_at < now() - interval '15 minutes'
    or p_mfa_authenticated_at > now() + interval '30 seconds'
  then
    raise exception 'Fresh founder TOTP assurance is required.' using errcode = '42501';
  end if;

  v_result := public.prepare_ops_trust_verification_decision(
    p_issue_id,
    p_profile_id,
    p_tailor_user_id,
    p_decision,
    p_reason,
    p_rejection_code,
    p_expected_record_version,
    p_idempotency_key,
    p_actor_principal_id,
    p_actor_label,
    'PRODUCTION',
    true,
    p_correlation_id
  );

  insert into public.ops_founder_trust_mfa_events (
    principal_id,
    auth_user_id,
    issue_id,
    event_type,
    outcome,
    correlation_id,
    mfa_authenticated_at,
    fallback_expires_at
  ) values (
    p_actor_principal_id,
    p_actor_auth_user_id,
    p_issue_id,
    'TRUST_DECISION_PREPARED',
    'SUCCEEDED',
    p_correlation_id,
    p_mfa_authenticated_at,
    v_fallback.expires_at
  ) on conflict (event_type, correlation_id) do nothing;

  return v_result;
end;
$$;

revoke all on function public.prepare_founder_mfa_trust_verification_decision(
  uuid, uuid, uuid, text, text, text, bigint, text, uuid, uuid, text, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.prepare_founder_mfa_trust_verification_decision(
  uuid, uuid, uuid, text, text, text, bigint, text, uuid, uuid, text, timestamptz, uuid
) to service_role;

-- The migration is safe to exercise on Dev: it creates the schema and leaves
-- the fallback disabled. Only the authoritative Production runtime receives
-- the temporary, auto-expiring binding.
do $enable_founder_fallback$
declare
  v_environment text;
  v_project_ref text;
  v_principal_id uuid;
  v_auth_user_id uuid;
begin
  select environment, project_ref
  into v_environment, v_project_ref
  from public.ops_runtime_configuration
  where singleton = true;

  if v_environment = 'DEVELOPMENT' and v_project_ref = 'pqptfuqogvrajozfsqzi' then
    return;
  end if;
  if v_environment is distinct from 'PRODUCTION'
    or v_project_ref is distinct from 'wkfsrunetmgjdtcurmoj'
  then
    raise exception 'Unexpected Ops runtime; founder trust MFA fallback was not enabled.';
  end if;

  select id into v_principal_id
  from public.ops_workforce_principals
  where lower(email) = 'founders@drapeon.co'
    and status = 'ACTIVE'
    and 'admin' = any(roles)
    and 'production' = any(permitted_environments)
    and access_review_due_at > now();

  select id into v_auth_user_id
  from auth.users
  where lower(email) = 'founders@drapeon.co'
    and email_confirmed_at is not null;

  if v_principal_id is null or v_auth_user_id is null then
    raise exception 'Confirmed founder Auth user and active Production principal are required.';
  end if;

  update public.ops_workforce_principals
  set auth_user_id = v_auth_user_id,
      updated_at = now()
  where id = v_principal_id
    and (auth_user_id is null or auth_user_id = v_auth_user_id);

  if not found then
    raise exception 'Founder workforce principal is already bound to another Auth user.';
  end if;

  insert into public.ops_founder_trust_mfa_fallback (
    singleton,
    project_ref,
    principal_id,
    auth_user_id,
    enabled,
    reason,
    enabled_at,
    expires_at
  ) values (
    true,
    'wkfsrunetmgjdtcurmoj',
    v_principal_id,
    v_auth_user_id,
    true,
    'Temporary founder TOTP step-up while the Cloudflare owner Google account is unavailable.',
    now(),
    timestamptz '2026-12-01 06:00:00+00'
  )
  on conflict (singleton) do update
  set principal_id = excluded.principal_id,
      auth_user_id = excluded.auth_user_id,
      enabled = true,
      reason = excluded.reason,
      enabled_at = now(),
      expires_at = excluded.expires_at,
      updated_at = now();
end;
$enable_founder_fallback$;
