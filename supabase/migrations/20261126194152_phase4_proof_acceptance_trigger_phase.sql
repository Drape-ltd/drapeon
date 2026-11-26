-- Quote acceptance marks the quote ACCEPTED before the order snapshot trigger
-- runs. The exact service-scoped proof context remains valid across that one
-- transaction phase; all other tuple and route checks stay unchanged.
set local lock_timeout='5s';
do $repair$
declare v_environment text; v_project_ref text; v_definition text;
begin
  select environment,project_ref into v_environment,v_project_ref
    from public.ops_runtime_configuration where singleton is true;
  if (v_environment,v_project_ref) not in
    (('DEVELOPMENT','pqptfuqogvrajozfsqzi'),
     ('PRODUCTION','wkfsrunetmgjdtcurmoj')) then
    raise exception 'PHASE4_PROOF_PHASE_PROJECT_GUARD';
  end if;
  v_definition:=pg_get_functiondef(
    'public.phase4_proof_context_valid(text,uuid,uuid,uuid,integer)'::regprocedure);
  if md5(v_definition)<>'5b155e5a23b35fa04a27b18e8b02732b' or
    position('q.status=''ACTIVE''' in v_definition)=0 then
    raise exception 'PHASE4_PROOF_PHASE_BASELINE_CHANGED';
  end if;
  v_definition:=replace(v_definition,
    'q.status=''ACTIVE''','q.status in (''ACTIVE'',''ACCEPTED'')');
  execute v_definition;
end $repair$;
