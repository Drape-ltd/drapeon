-- Production-forward repair: the scheduled purge worker writes durable retry
-- state here.
create table if not exists public.tailor_draft_purges (
  invite_id uuid primary key,
  tailor_user_id uuid not null,
  tailor_profile_id text not null,
  terminal_status text not null check (terminal_status in ('EXPIRED','REVOKED','DECLINED')),
  step text not null default 'QUEUED'
    check (step in ('QUEUED','MEDIA_DELETED','PROFILE_DELETED','AUTH_DELETED','DONE')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tailor_draft_purges_pending_idx
  on public.tailor_draft_purges (created_at)
  where step <> 'DONE';

alter table public.tailor_draft_purges enable row level security;
revoke all on table public.tailor_draft_purges from public, anon, authenticated;
grant select, insert, update on table public.tailor_draft_purges to service_role;
