-- Restore the one required Dev Ops SLA cron missing from the live scheduler.
-- The existing bounded worker and grants are unchanged. The command marker
-- makes rollback remove only a job created by this migration.
do $restore$
declare
  v_job record;
  v_command constant text := 'select public.enqueue_ops_slack_sla_reminders();';
  v_created_command constant text :=
    'select public.enqueue_ops_slack_sla_reminders(); -- restored-by-20261111003000';
begin
  if public.current_ops_environment() <> 'DEVELOPMENT' then return; end if;

  select jobid, schedule, command, active into v_job
  from cron.job where jobname = 'ops-slack-sla-reminders';
  if found then
    if v_job.active and v_job.schedule = '27,57 * * * *'
      and btrim(v_job.command) in (v_command, v_created_command) then
      return;
    end if;
    raise exception 'OPS_SLA_CRON_DRIFT: review the existing schedule before changing it';
  end if;

  perform cron.schedule(
    'ops-slack-sla-reminders',
    '27,57 * * * *',
    v_created_command
  );
end;
$restore$;
