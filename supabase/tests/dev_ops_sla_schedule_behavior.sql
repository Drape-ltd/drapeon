do $test$
declare v_job record;
begin
  select * into v_job from cron.job where jobname = 'ops-slack-sla-reminders';
  if not found then raise exception 'required Dev SLA cron is missing'; end if;
  if not v_job.active or v_job.schedule <> '27,57 * * * *'
    or btrim(v_job.command) <>
      'select public.enqueue_ops_slack_sla_reminders(); -- restored-by-20261111140000' then
    raise exception 'Dev SLA cron schedule or command drifted';
  end if;
  if (select count(*) from cron.job) <> 1 then
    raise exception 'repair created an unrelated cron';
  end if;
  raise notice 'PASS: one bounded Dev SLA schedule exists';
end;
$test$;
