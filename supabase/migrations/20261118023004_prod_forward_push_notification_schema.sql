-- Forward repair for the Production notification contract. The historical
-- receipt/provenance migrations are not in Production's ledger and must not
-- be replayed wholesale. This schema-only step is idempotent and contains no
-- data repair, scheduler change, or provider call.

alter table public.push_tokens
  add column if not exists expo_project_id text,
  add column if not exists app_variant text,
  add column if not exists application_id text,
  add column if not exists apns_environment text,
  add column if not exists token_generation_started_at timestamptz not null default now(),
  add column if not exists quarantined_at timestamptz,
  add column if not exists quarantine_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.push_tokens'::regclass
      and conname = 'push_tokens_app_variant_check'
  ) then
    alter table public.push_tokens add constraint push_tokens_app_variant_check check (
      app_variant is null or app_variant in ('development', 'preview', 'testflight', 'production')
    );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.push_tokens'::regclass
      and conname = 'push_tokens_apns_environment_check'
  ) then
    alter table public.push_tokens add constraint push_tokens_apns_environment_check check (
      apns_environment is null or apns_environment in ('development', 'production')
    );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.push_tokens'::regclass
      and conname = 'push_tokens_quarantine_pair_check'
  ) then
    alter table public.push_tokens add constraint push_tokens_quarantine_pair_check check (
      (quarantined_at is null) = (quarantine_reason is null)
    );
  end if;
end $$;

alter table public.push_delivery_attempts
  add column if not exists notification_job_id uuid
  references public.job_queue(id) on delete set null;

create index if not exists push_delivery_attempts_notification_job_idx
  on public.push_delivery_attempts (notification_job_id)
  where notification_job_id is not null;
