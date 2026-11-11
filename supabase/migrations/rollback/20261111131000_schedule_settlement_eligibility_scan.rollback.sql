do $$
declare v_job record;
begin
  select jobid, command into v_job
  from cron.job where jobname = 'refresh-settlement-eligibility';
  if v_job.jobid is null then return; end if;
  if v_job.command <> $job$select util.invoke_edge_function('monitor-settlements', '{"mode":"ELIGIBILITY_ONLY"}'::jsonb, 300000);$job$ then
    raise exception 'Settlement eligibility cron command drifted; inspect before rollback';
  end if;
  perform cron.unschedule(v_job.jobid);
end $$;
