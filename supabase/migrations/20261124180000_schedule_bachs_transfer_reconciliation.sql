-- Deploy monitor-settlements with BACHS_TRANSFER_ONLY and verify it on Dev
-- before scheduling. This mode only retrieves existing Bachs transfer attempts.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-bachs-transfer-claims') then
    raise exception 'Bachs transfer reconciliation cron already exists; inspect it before applying';
  end if;
  perform cron.schedule(
    'reconcile-bachs-transfer-claims',
    '*/15 * * * *',
    $job$select util.invoke_edge_function('monitor-settlements', '{"mode":"BACHS_TRANSFER_ONLY"}'::jsonb, 300000);$job$
  );
end $$;
