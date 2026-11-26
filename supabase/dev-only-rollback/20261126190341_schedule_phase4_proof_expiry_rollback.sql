-- This rollback only removes the scheduler; the RPC continues to enforce
-- expiry synchronously and all proof/audit rows remain intact.
do $$
begin
  perform cron.unschedule(jobid) from cron.job
    where jobname='expire-phase4-payment-proofs';
end $$;
