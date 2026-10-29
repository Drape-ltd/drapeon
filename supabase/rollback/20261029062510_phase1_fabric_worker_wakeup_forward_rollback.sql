-- Emergency rollback only: removes the fabric wake path and restores the
-- pre-fix webhook/tip-only filters, reintroducing the known fabric-job stall.

do $$
declare
  v_trigger text;
begin
  select pg_get_triggerdef(t.oid)
    into v_trigger
  from pg_trigger t
  where t.tgrelid = 'public.job_queue'::regclass
    and t.tgname = 'trg_wake_fabric_release_job_worker'
    and not t.tgisinternal;

  if v_trigger is null
    or position('PROCESS_FABRIC_RELEASE' in v_trigger) = 0 then
    raise exception 'Refusing rollback: fabric-release trigger is missing or has drifted';
  end if;

  if position('PROCESS_FABRIC_RELEASE' in
      pg_get_functiondef('public.wake_money_job_worker()'::regprocedure)) = 0
    or position('PROCESS_FABRIC_RELEASE' in
      pg_get_functiondef('public.wake_due_money_jobs()'::regprocedure)) = 0 then
    raise exception 'Refusing rollback: money-job wake functions have drifted';
  end if;
end;
$$;

drop trigger trg_wake_fabric_release_job_worker on public.job_queue;

create or replace function public.wake_money_job_worker()
returns trigger
language plpgsql
security definer
set search_path = public, util, extensions, pg_temp
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
    raise warning 'money job wakeup deferred for job %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

create or replace function public.wake_due_money_jobs()
returns bigint
language plpgsql
security definer
set search_path = public, util, extensions, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.job_queue
    where job_type in (
      'PROCESS_PAYMENT_WEBHOOK',
      'RECONCILE_PAYMENT_WEBHOOK',
      'PROCESS_TIP_PAYOUT'
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
    '{"limit":50,"jobTypes":["PROCESS_PAYMENT_WEBHOOK","RECONCILE_PAYMENT_WEBHOOK","PROCESS_TIP_PAYOUT"]}'::jsonb,
    55000
  );
end;
$$;

revoke all on function public.wake_money_job_worker()
  from public, anon, authenticated;
revoke all on function public.wake_due_money_jobs()
  from public, anon, authenticated;
grant execute on function public.wake_due_money_jobs() to service_role;
