-- Forward repair for the Dev-applied proof migration. The every-minute cron
-- from 20261126190341 is Dev-only and must never be promoted to Production.
-- Every money authorization still checks expires_at synchronously.
set local lock_timeout = '5s';

do $guard$
declare v_environment text; v_project_ref text; v_definition text;
begin
  select environment,project_ref into v_environment,v_project_ref
    from public.ops_runtime_configuration where singleton is true;
  if (v_environment,v_project_ref) not in
    (('DEVELOPMENT','pqptfuqogvrajozfsqzi'),
     ('PRODUCTION','wkfsrunetmgjdtcurmoj')) then
    raise exception 'PHASE4_PROOF_REPAIR_PROJECT_GUARD';
  end if;
  v_definition := pg_get_functiondef(
    'public.open_phase4_payment_proof(text,text,text,integer,uuid,integer,timestamptz,text)'::regprocedure);
  if md5(v_definition)<>'4af48a0dd6bb4cbb5a082e2038c0c82f'
    or position(E'begin\n  if p_actor' in v_definition)=0 then
    raise exception 'PHASE4_PROOF_OPEN_BASELINE_CHANGED';
  end if;
  v_definition:=replace(v_definition,E'begin\n  if p_actor',
    E'begin\n  perform public.expire_phase4_payment_proofs(1);\n  if p_actor');
  execute v_definition;
end $guard$;

drop trigger if exists guard_phase4_payment_proof_before_update
  on public.phase4_payment_proofs;
create trigger guard_phase4_payment_proof_before_write
  before update or delete on public.phase4_payment_proofs
  for each row execute function public.guard_phase4_payment_proof();

create function public.guard_phase4_payment_proof_event()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  raise exception 'PHASE4_PROOF_EVENT_APPEND_ONLY';
end $$;
revoke execute on function public.guard_phase4_payment_proof_event()
  from public,anon,authenticated,service_role;
create trigger guard_phase4_payment_proof_event_before_write
  before update or delete on public.phase4_payment_proof_events
  for each row execute function public.guard_phase4_payment_proof_event();

do $unschedule$
declare v_job record;
begin
  for v_job in select jobid,schedule,command from cron.job
    where jobname='expire-phase4-payment-proofs'
  loop
    if v_job.schedule<>'* * * * *' or
       v_job.command<>'select public.expire_phase4_payment_proofs(1);' then
      raise exception 'PHASE4_PROOF_EXPIRY_SCHEDULE_DRIFT';
    end if;
    perform cron.unschedule(v_job.jobid);
  end loop;
end $unschedule$;
