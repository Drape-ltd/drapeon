-- Reconcile the Phase 1 fabric-worker fix onto the current production baseline.
-- Keep the established webhook/tip insert trigger and bounded recovery schedule;
-- add the fabric job type through a second, narrowly-scoped trigger.

create or replace function public.wake_money_job_worker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_types text[];
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

  if v_job_types is null then
    return new;
  end if;

  begin
    perform util.invoke_edge_function(
      'process-job-queue',
      jsonb_build_object('limit', 50, 'jobTypes', to_jsonb(v_job_types)),
      55000
    );
  exception when others then
    -- The durable row remains authoritative; bounded recovery retries the wake.
    raise warning 'money job wakeup deferred for job %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

create or replace function public.wake_due_money_jobs()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.job_queue
    where job_type in (
      'PROCESS_PAYMENT_WEBHOOK',
      'RECONCILE_PAYMENT_WEBHOOK',
      'PROCESS_TIP_PAYOUT',
      'PROCESS_FABRIC_RELEASE'
    )
      and (
        (status in ('PENDING', 'RETRYABLE') and run_at <= now())
        or (status = 'PROCESSING' and locked_at < now() - interval '15 minutes')
      )
  ) then
    return null;
  end if;

  return util.invoke_edge_function(
    'process-job-queue',
    '{"limit":50,"jobTypes":["PROCESS_PAYMENT_WEBHOOK","RECONCILE_PAYMENT_WEBHOOK","PROCESS_TIP_PAYOUT","PROCESS_FABRIC_RELEASE"]}'::jsonb,
    55000
  );
end;
$$;

revoke all on function public.wake_money_job_worker()
  from public, anon, authenticated;
revoke all on function public.wake_due_money_jobs()
  from public, anon, authenticated;
grant execute on function public.wake_due_money_jobs() to service_role;

do $$
declare
  v_trigger text;
  v_existing_trigger text;
  v_wake text;
  v_recovery text;
begin
  select pg_get_triggerdef(t.oid)
    into v_existing_trigger
  from pg_trigger t
  where t.tgrelid = 'public.job_queue'::regclass
    and t.tgname = 'trg_wake_money_job_worker'
    and not t.tgisinternal
    and t.tgenabled <> 'D';

  if v_existing_trigger is null then
    raise exception 'Existing webhook/tip worker wake trigger is missing or disabled';
  end if;

  select pg_get_triggerdef(t.oid)
    into v_trigger
  from pg_trigger t
  where t.tgrelid = 'public.job_queue'::regclass
    and t.tgname = 'trg_wake_fabric_release_job_worker'
    and not t.tgisinternal
    and t.tgenabled <> 'D';

  if v_trigger is null then
    create trigger trg_wake_fabric_release_job_worker
      after insert on public.job_queue
      for each row
      when (new.job_type = 'PROCESS_FABRIC_RELEASE')
      execute function public.wake_money_job_worker();
  elsif position('PROCESS_FABRIC_RELEASE' in v_trigger) = 0
    or position('wake_money_job_worker' in v_trigger) = 0 then
    raise exception 'Existing fabric worker trigger has drifted';
  end if;

  select pg_get_functiondef('public.wake_money_job_worker()'::regprocedure)
    into v_wake;
  if position('PROCESS_FABRIC_RELEASE' in v_wake) = 0
    or position('process-job-queue' in v_wake) = 0 then
    raise exception 'Immediate fabric release wakeup is incomplete';
  end if;

  select pg_get_functiondef('public.wake_due_money_jobs()'::regprocedure)
    into v_recovery;
  if position('PROCESS_FABRIC_RELEASE' in v_recovery) = 0
    or position('PROCESS_TIP_PAYOUT' in v_recovery) = 0 then
    raise exception 'Bounded money-job recovery omits fabric release or tip payout';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname = 'process-money-jobs-recovery'
      and active
      and command like '%wake_due_money_jobs%'
  ) then
    raise exception 'Existing bounded money-job recovery schedule is missing or inactive';
  end if;
end;
$$;
