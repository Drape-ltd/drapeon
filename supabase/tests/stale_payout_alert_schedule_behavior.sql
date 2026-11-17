do $test$
declare v_job record;
begin
  select * into v_job from cron.job where jobname = 'alert-stale-payout-reservations';
  if not found then raise exception 'required alert-only payout cron is missing'; end if;
  if not v_job.active or v_job.schedule <> '9,39 * * * *' or
     v_job.command <> $job$select util.invoke_edge_function('monitor-settlements', '{"mode":"ALERT_ONLY"}'::jsonb, 300000);$job$ then
    raise exception 'payout cron is not restricted to ALERT_ONLY';
  end if;
  if (select count(*) from cron.job where jobname = 'alert-stale-payout-reservations') <> 1 then
    raise exception 'duplicate stale payout alert cron';
  end if;
  raise notice 'PASS: one bounded alert-only payout cron exists';
end;
$test$;
