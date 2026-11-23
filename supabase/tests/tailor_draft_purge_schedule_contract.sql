begin;

do $$
declare
  v_job record;
begin
  select jobid, schedule, command, active
    into v_job
  from cron.job
  where jobname = 'purge-tailor-drafts';

  if v_job.jobid is null then
    raise exception 'purge-tailor-drafts cron job is missing';
  end if;
  if v_job.schedule <> '17 * * * *' then
    raise exception 'unexpected purge cadence: %', v_job.schedule;
  end if;
  if v_job.command <> $job$select util.invoke_edge_function('purge-tailor-drafts', '{}'::jsonb, 300000);$job$ then
    raise exception 'unexpected purge command: %', v_job.command;
  end if;
  if not v_job.active then
    raise exception 'purge-tailor-drafts cron job is inactive';
  end if;
end
$$;

rollback;
