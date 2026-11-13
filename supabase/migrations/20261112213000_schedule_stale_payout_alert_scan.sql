-- Apply only after ALERT_ONLY has been deployed and manually verified on Dev.
-- This scan raises Ops issues only; the full monitor remains unscheduled.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'alert-stale-payout-reservations') then
    raise exception 'Stale payout alert cron already exists; inspect it before applying';
  end if;
  perform cron.schedule(
    'alert-stale-payout-reservations',
    '9,39 * * * *',
    $job$select util.invoke_edge_function('monitor-settlements', '{"mode":"ALERT_ONLY"}'::jsonb, 300000);$job$
  );
end $$;
