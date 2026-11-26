-- Production-forward scheduler step. Run only after the monitor objects exist.
-- Preserve the hourly purge cadence; record its pg_net request ID so the
-- five-minute monitor can observe the actual Edge HTTP outcome.
do $$
begin
  if to_regprocedure('util.invoke_monitored_edge_function(text,jsonb,integer)') is null
     or to_regprocedure('public.reconcile_cron_edge_outcomes(integer)') is null then
    raise exception 'Cron outcome monitor objects missing; apply the objects migration first';
  end if;
  if (select count(*) from cron.job where jobname = 'purge-tailor-drafts') <> 1
     or not exists (
       select 1 from cron.job
       where jobname = 'purge-tailor-drafts'
         and schedule = '17 * * * *'
         and command = $job$select util.invoke_edge_function('purge-tailor-drafts', '{}'::jsonb, 300000);$job$
     ) then
    raise exception 'Production purge cron drifted; inspect before scheduling monitor';
  end if;
  if exists (select 1 from cron.job where jobname = 'reconcile-cron-edge-outcomes') then
    raise exception 'Cron outcome monitor job already exists; inspect before applying';
  end if;
end;
$$;

select cron.schedule(
  'purge-tailor-drafts',
  '17 * * * *',
  $job$select util.invoke_monitored_edge_function('purge-tailor-drafts', '{}'::jsonb, 300000);$job$
);

select cron.schedule(
  'reconcile-cron-edge-outcomes',
  '*/5 * * * *',
  $job$select public.reconcile_cron_edge_outcomes(50);$job$
);
