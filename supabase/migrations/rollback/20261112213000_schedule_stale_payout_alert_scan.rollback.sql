do $$
declare v_job record;
begin
  select jobid, schedule, command into v_job
  from cron.job where jobname = 'alert-stale-payout-reservations';
  if v_job.jobid is null then return; end if;
  if v_job.schedule <> '9,39 * * * *' or
     v_job.command <> $job$select util.invoke_edge_function('monitor-settlements', '{"mode":"ALERT_ONLY"}'::jsonb, 300000);$job$ then
    raise exception 'Stale payout alert cron drifted; inspect before rollback';
  end if;
  perform cron.unschedule(v_job.jobid);
end $$;
