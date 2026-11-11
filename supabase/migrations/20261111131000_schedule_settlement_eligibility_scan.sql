-- Apply only after the eligibility-only monitor mode is deployed and verified.
-- The full monitor remains unscheduled: it can reconcile and reserve payouts.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-settlement-eligibility') then
    raise exception 'Settlement eligibility cron job already exists; inspect it before applying';
  end if;
  perform cron.schedule(
    'refresh-settlement-eligibility',
    '4,19,34,49 * * * *',
    $job$select util.invoke_edge_function('monitor-settlements', '{"mode":"ELIGIBILITY_ONLY"}'::jsonb, 300000);$job$
  );
end $$;
