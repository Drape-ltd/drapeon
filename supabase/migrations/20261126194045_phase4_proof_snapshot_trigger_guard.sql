-- The canonical acceptance RPC has a second route-status guard in the order
-- trigger. Permit only the exact, service-scoped proof context there too.
set local lock_timeout='5s';
do $repair$
declare v_environment text; v_project_ref text; v_definition text;
begin
  select environment,project_ref into v_environment,v_project_ref
    from public.ops_runtime_configuration where singleton is true;
  if (v_environment,v_project_ref) not in
    (('DEVELOPMENT','pqptfuqogvrajozfsqzi'),
     ('PRODUCTION','wkfsrunetmgjdtcurmoj')) then
    raise exception 'PHASE4_PROOF_TRIGGER_PROJECT_GUARD';
  end if;
  v_definition:=pg_get_functiondef(
    'private.guard_accepted_payment_route_snapshot()'::regprocedure);
  if md5(v_definition)<>'b94ec73ddf12fd1ce54c3a65424654de' or
    position(E'or v_route.status = ''DISABLED''\n' in v_definition)=0 then
    raise exception 'PHASE4_PROOF_TRIGGER_BASELINE_CHANGED';
  end if;
  v_definition:=replace(v_definition,
    E'or v_route.status = ''DISABLED''\n',
    E'or (v_route.status = ''DISABLED'' and not public.phase4_proof_context_valid(\n        new.id::text,new.customer_id::uuid,new.active_quote_id,\n        new.payment_route_id,new.payment_route_version))\n');
  execute v_definition;
end $repair$;
