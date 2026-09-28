-- Drapeon lifecycle feedback responses.
--
-- Survey responses are operational feedback, not a marketing contact list. The
-- service-owned submission function enforces eligibility, suppression, and
-- one-response semantics before writing here. Keep the table private so free
-- text and issue tags never become a client-readable analytics surface.

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'CUSTOMER_POST_COMPLETION_CSAT',
    'SUPPORT_RESOLUTION_CSAT',
    'TAILOR_FIRST_ORDER_CSAT',
    'ONBOARDING_PULSE'
  )),
  version integer not null default 1 check (version = 1),
  subject_type text not null check (subject_type in ('ORDER', 'SUPPORT_CASE', 'ACCOUNT')),
  subject_id text not null check (char_length(trim(subject_id)) between 1 and 120),
  role text not null check (role in ('CUSTOMER', 'TAILOR')),
  channel text not null check (channel in ('WEB', 'IOS', 'ANDROID', 'EMAIL')),
  score smallint not null check (score between 1 and 5),
  tags text[] not null default '{}',
  comment text check (comment is null or char_length(comment) <= 1000),
  idempotency_key text not null unique,
  ops_issue_id uuid references public.ops_issues(id) on delete set null,
  retention_until timestamptz not null default (now() + interval '365 days'),
  created_at timestamptz not null default now()
);

create unique index if not exists survey_responses_subject_once_idx
  on public.survey_responses (user_id, kind, version, subject_type, subject_id);

create index if not exists survey_responses_kind_created_idx
  on public.survey_responses (kind, created_at desc);

create index if not exists survey_responses_retention_idx
  on public.survey_responses (retention_until);

alter table public.survey_responses enable row level security;

revoke all on public.survey_responses from public, anon, authenticated;
grant select, insert, update, delete on public.survey_responses to service_role;

comment on table public.survey_responses is
  'Private, versioned lifecycle feedback. Submission and Ops routing are service-owned; comments never enter analytics payloads.';
