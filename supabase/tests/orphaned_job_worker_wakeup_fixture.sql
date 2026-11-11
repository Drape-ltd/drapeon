-- Isolated PostgreSQL fixture. Relevant job_queue columns and function
-- signatures match the live Dev schema checked on 2026-11-08. No provider
-- calls are made: util.invoke_edge_function records wake payloads locally.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema util;
create schema cron;

create table public.job_queue (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  status text not null default 'PENDING',
  run_at timestamptz not null default now(),
  locked_at timestamptz
);

create table cron.job (
  jobname text primary key,
  active boolean not null,
  command text not null
);
insert into cron.job values
  ('process-money-jobs-recovery', true, 'select public.wake_due_money_jobs();');

create table util.edge_invocations (
  id bigint generated always as identity primary key,
  function_name text not null,
  request jsonb not null,
  timeout_ms integer not null
);

create function util.invoke_edge_function(p_name text, p_request jsonb, p_timeout integer)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into util.edge_invocations(function_name, request, timeout_ms)
  values (p_name, p_request, p_timeout)
  returning id into v_id;
  return v_id;
end;
$$;

-- The effective pre-fix Dev functions are the bodies from
-- 20261029062510_phase1_fabric_worker_wakeup_forward.sql.
create or replace function public.wake_money_job_worker()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_job_types text[];
begin
  if new.status not in ('PENDING', 'RETRYABLE') or new.run_at > now() then
    return new;
  end if;
  v_job_types := case
    when new.job_type in ('PROCESS_PAYMENT_WEBHOOK', 'RECONCILE_PAYMENT_WEBHOOK')
      then array['PROCESS_PAYMENT_WEBHOOK', 'RECONCILE_PAYMENT_WEBHOOK']::text[]
    when new.job_type = 'PROCESS_TIP_PAYOUT'
      then array['PROCESS_TIP_PAYOUT']::text[]
    when new.job_type = 'PROCESS_FABRIC_RELEASE'
      then array['PROCESS_FABRIC_RELEASE']::text[]
    else null
  end;
  if v_job_types is null then return new; end if;
  begin
    perform util.invoke_edge_function('process-job-queue',
      jsonb_build_object('limit', 50, 'jobTypes', to_jsonb(v_job_types)), 55000);
  exception when others then
    raise warning 'money job wakeup deferred for job %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.wake_due_money_jobs()
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.job_queue
    where job_type in ('PROCESS_PAYMENT_WEBHOOK', 'RECONCILE_PAYMENT_WEBHOOK',
                       'PROCESS_TIP_PAYOUT', 'PROCESS_FABRIC_RELEASE')
      and ((status in ('PENDING', 'RETRYABLE') and run_at <= now())
        or (status = 'PROCESSING' and locked_at < now() - interval '15 minutes'))
  ) then return null; end if;
  return util.invoke_edge_function('process-job-queue',
    '{"limit":50,"jobTypes":["PROCESS_PAYMENT_WEBHOOK","RECONCILE_PAYMENT_WEBHOOK","PROCESS_TIP_PAYOUT","PROCESS_FABRIC_RELEASE"]}'::jsonb,
    55000);
end;
$$;

create trigger trg_wake_money_job_worker after insert on public.job_queue
  for each row when (new.job_type in (
    'PROCESS_PAYMENT_WEBHOOK', 'RECONCILE_PAYMENT_WEBHOOK', 'PROCESS_TIP_PAYOUT'))
  execute function public.wake_money_job_worker();
create trigger trg_wake_fabric_release_job_worker after insert on public.job_queue
  for each row when (new.job_type = 'PROCESS_FABRIC_RELEASE')
  execute function public.wake_money_job_worker();
