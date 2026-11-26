-- Forward-only security repair. Reinstating an every-minute cron or removing
-- append-only guards is unsafe. Write a reviewed forward correction instead.
do $$ begin
  raise exception 'PHASE4_PROOF_REPAIR_FORWARD_ONLY';
end $$;
