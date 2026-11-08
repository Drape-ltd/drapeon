-- Must fail on the effective main/Dev functions and pass after the forward
-- migration. All rows are local fixture rows; no money or provider state.
begin;
truncate public.job_queue, util.edge_invocations restart identity;

insert into public.job_queue(job_type)
values ('PROCESS_DISPATCH_REFUND'), ('RECONCILE_DISPATCH_RUN'),
       ('PROCESS_DELIVERY_WEBHOOK'), ('RECONCILE_DELIVERY_WEBHOOK'),
       ('SEND_COMMUNICATION_CAMPAIGN');

do $$
begin
  if (select count(*) from util.edge_invocations) <> 5
    or exists (
      select 1 from (values ('PROCESS_DISPATCH_REFUND'),
        ('RECONCILE_DISPATCH_RUN'), ('PROCESS_DELIVERY_WEBHOOK'),
        ('RECONCILE_DELIVERY_WEBHOOK'), ('SEND_COMMUNICATION_CAMPAIGN')) as expected(job_type)
      where not exists (
        select 1 from util.edge_invocations i
        where i.function_name = 'process-job-queue'
          and i.request -> 'jobTypes' = jsonb_build_array(expected.job_type)
          and i.request ->> 'limit' = '50' and i.timeout_ms = 55000
      )
    ) then
    raise exception 'an orphaned job insert did not wake the worker';
  end if;
end;
$$;

select public.wake_due_money_jobs();
do $$
begin
  if (select count(*) from util.edge_invocations) <> 6
    or not exists (
      select 1 from util.edge_invocations
      where request -> 'jobTypes' ? 'PROCESS_DISPATCH_REFUND'
        and request -> 'jobTypes' ? 'PROCESS_FABRIC_RELEASE'
        and request -> 'jobTypes' ? 'PROCESS_TIP_PAYOUT'
        and request -> 'jobTypes' ? 'RECONCILE_DISPATCH_RUN'
        and request -> 'jobTypes' ? 'PROCESS_DELIVERY_WEBHOOK'
        and request -> 'jobTypes' ? 'RECONCILE_DELIVERY_WEBHOOK'
        and request -> 'jobTypes' ? 'SEND_COMMUNICATION_CAMPAIGN'
    ) then
    raise exception 'dispatch refund was omitted from bounded recovery';
  end if;
end;
$$;

-- A repeated sweep is only another wake; it does not change or duplicate the
-- durable job. The worker owns claims and provider idempotency.
select public.wake_due_money_jobs();
do $$
begin
  if (select count(*) from public.job_queue) <> 5
    or (select count(*) from util.edge_invocations) <> 7 then
    raise exception 'replayed wake changed the durable job';
  end if;
end;
$$;

truncate public.job_queue, util.edge_invocations restart identity;
insert into public.job_queue(job_type, run_at)
values ('PROCESS_DISPATCH_REFUND', now() + interval '1 hour');
insert into public.job_queue(job_type, status)
values ('PROCESS_DISPATCH_REFUND', 'FAILED');
do $$
begin
  if exists (select 1 from util.edge_invocations)
    or public.wake_due_money_jobs() is not null then
    raise exception 'future or terminal dispatch job woke worker';
  end if;
end;
$$;

truncate public.job_queue, util.edge_invocations restart identity;
insert into public.job_queue(job_type, status, locked_at)
values ('PROCESS_DISPATCH_REFUND', 'PROCESSING', now() - interval '16 minutes');
select public.wake_due_money_jobs();
do $$
begin
  if (select count(*) from util.edge_invocations) <> 1 then
    raise exception 'stale processing dispatch refund was not recovered';
  end if;
end;
$$;

truncate public.job_queue, util.edge_invocations restart identity;
insert into public.job_queue(job_type)
values ('PROCESS_PAYMENT_WEBHOOK'), ('RECONCILE_PAYMENT_WEBHOOK'),
       ('PROCESS_TIP_PAYOUT'), ('PROCESS_FABRIC_RELEASE');
do $$
begin
  if (select count(*) from util.edge_invocations) <> 4
    or (select count(*) from util.edge_invocations
        where request -> 'jobTypes' ? 'PROCESS_PAYMENT_WEBHOOK') <> 2
    or (select count(*) from util.edge_invocations
        where request -> 'jobTypes' = '["PROCESS_TIP_PAYOUT"]'::jsonb) <> 1
    or (select count(*) from util.edge_invocations
        where request -> 'jobTypes' = '["PROCESS_FABRIC_RELEASE"]'::jsonb) <> 1 then
    raise exception 'existing payment, tip or fabric wake changed';
  end if;
end;
$$;

rollback;
begin;
truncate public.job_queue, util.edge_invocations restart identity;
insert into public.job_queue(job_type, status)
values ('PROCESS_DISPATCH_REFUND', 'RETRYABLE');
do $$
begin
  if (select count(*) from util.edge_invocations) <> 1 then
    raise exception 'retryable dispatch refund insert did not wake worker';
  end if;
  if has_function_privilege('anon', 'public.wake_due_money_jobs()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.wake_due_money_jobs()', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.wake_due_money_jobs()', 'EXECUTE') then
    raise exception 'bounded recovery function execute grants drifted';
  end if;
end;
$$;
rollback;
select 'PASS five orphaned job lanes: immediate, bounded recovery, replay and adjacent paths' as result;
