select cron.unschedule('reconcile-bachs-transfer-claims')
where exists (select 1 from cron.job where jobname = 'reconcile-bachs-transfer-claims');
