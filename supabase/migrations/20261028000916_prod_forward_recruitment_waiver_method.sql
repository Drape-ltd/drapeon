-- Forward-only: repair future waiver decisions without rewriting existing
-- profiles, cases, or verification records. Preserve the installed function.
do $$
declare
  definition text;
  target_function regprocedure;
  old_method constant text := $pattern$id_verification_method[[:space:]]*=[[:space:]]*'CHALLENGE_VIDEO'$pattern$;
  new_method constant text := $pattern$id_verification_method[[:space:]]*=[[:space:]]*'ADMIN_RECRUITMENT_WAIVER'$pattern$;
begin
  target_function := to_regprocedure(
    'public.ops_trust_exception_action_snapshot_v1(text,uuid,uuid,text,boolean,text,text,text,uuid,uuid,bigint,boolean,boolean)'
  );
  if target_function is null then
    raise exception 'Recruitment waiver snapshot function unavailable; reconcile wrapper before repair';
  end if;
  select pg_get_functiondef(target_function) into definition;
  if definition ~ new_method and definition !~ old_method then
    return;
  end if;
  if definition is null or definition !~ old_method then
    raise exception 'Unexpected recruitment waiver function body; manual review required';
  end if;
  definition := regexp_replace(
    definition, old_method, 'id_verification_method = ''ADMIN_RECRUITMENT_WAIVER'''
  );
  if definition ~ old_method or definition !~ new_method then
    raise exception 'Recruitment waiver replacement failed verification';
  end if;
  execute definition;
end;
$$;
