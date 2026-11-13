do $test$
begin
  if exists (select 1 from cron.job where jobname = 'alert-stale-payout-reservations') then
    raise exception 'alert-only payout cron remained after rollback';
  end if;
  raise notice 'PASS: alert-only payout cron removed';
end;
$test$;
