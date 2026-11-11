do $test$
begin
  if exists (select 1 from cron.job where jobname = 'ops-slack-sla-reminders') then
    raise exception 'rollback left the migration-created job';
  end if;
  raise notice 'PASS: rollback removed only the created schedule';
end;
$test$;
