-- Roll back the Edge release that relies on this job type first. This restores
-- the exact pre-migration Dev worker functions and removes only the new trigger.

drop trigger if exists trg_wake_unowned_job_worker on public.job_queue;

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
