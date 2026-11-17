do $$
declare v_job record;
begin
  select jobid, schedule, command into v_job from cron.job where jobname='reconcile-cron-edge-outcomes';
  if v_job.jobid is not null then
    if v_job.schedule <> '*/5 * * * *' or v_job.command <> $job$select public.reconcile_cron_edge_outcomes(50);$job$ then
      raise exception 'Cron outcome reconciliation job drifted; inspect before rollback';
    end if;
    perform cron.unschedule(v_job.jobid);
  end if;

  select jobid, schedule, command into v_job from cron.job where jobname='purge-tailor-drafts';
  if v_job.jobid is null or v_job.schedule <> '17 * * * *'
     or v_job.command <> $job$select util.invoke_monitored_edge_function('purge-tailor-drafts', '{}'::jsonb, 300000);$job$ then
    raise exception 'Tailor draft purge job drifted; inspect before rollback';
  end if;
  perform cron.schedule('purge-tailor-drafts','17 * * * *',
    $job$select util.invoke_edge_function('purge-tailor-drafts', '{}'::jsonb, 300000);$job$);
end $$;

drop function public.reconcile_cron_edge_outcomes(integer);
drop function util.invoke_monitored_edge_function(text,jsonb,integer);
drop table public.cron_edge_invocations;
