-- Remove only the Dev cron created by 20261111003000. An older matching
-- schedule has no marker and is preserved. No Ops case is changed here.
do $rollback$
declare
  v_job record;
begin
  if public.current_ops_environment() <> 'DEVELOPMENT' then return; end if;

  select jobid, schedule, command into v_job
  from cron.job where jobname = 'ops-slack-sla-reminders';
  if not found then return; end if;
  if v_job.schedule = '27,57 * * * *'
    and btrim(v_job.command) =
      'select public.enqueue_ops_slack_sla_reminders(); -- restored-by-20261111003000' then
    perform cron.unschedule(v_job.jobid);
  end if;
end;
$rollback$;
