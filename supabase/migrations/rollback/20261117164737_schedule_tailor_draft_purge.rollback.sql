do $$
declare
  v_job record;
begin
  select jobid, schedule, command
    into v_job
  from cron.job
  where jobname = 'purge-tailor-drafts';

  if v_job.jobid is null then
    return;
  end if;

  if v_job.schedule <> '17 * * * *'
     or v_job.command <> $job$select util.invoke_edge_function('purge-tailor-drafts', '{}'::jsonb, 300000);$job$ then
    raise exception 'Tailor draft purge cron drifted; inspect before rollback';
  end if;

  perform cron.unschedule(v_job.jobid);
end
$$;
