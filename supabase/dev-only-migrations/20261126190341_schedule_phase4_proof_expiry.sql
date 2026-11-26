-- Bounded, provider-free expiry of the one controlled payment proof.
do $guard$
declare v_environment text; v_project_ref text;
begin
  select environment,project_ref into v_environment,v_project_ref
    from public.ops_runtime_configuration where singleton is true;
  if (v_environment,v_project_ref) not in
    (('DEVELOPMENT','pqptfuqogvrajozfsqzi'),
     ('PRODUCTION','wkfsrunetmgjdtcurmoj')) then
    raise exception 'PHASE4_PROOF_EXPIRY_PROJECT_GUARD';
  end if;
  if to_regprocedure('public.expire_phase4_payment_proofs(integer)') is null then
    raise exception 'PHASE4_PROOF_EXPIRY_FUNCTION_MISSING';
  end if;
end $guard$;

do $schedule$
begin
  perform cron.unschedule(jobid) from cron.job
    where jobname='expire-phase4-payment-proofs';
  perform cron.schedule('expire-phase4-payment-proofs', '* * * * *',
    $job$select public.expire_phase4_payment_proofs(1);$job$);
end $schedule$;
