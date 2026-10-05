-- Preserve the distinction between reviewing a challenge video and explicitly
-- waiving its absence. This changes only future waiver decisions; no profiles
-- or existing verification records are rewritten.
do $$
declare
  definition text;
  target_function regprocedure;
  old_method constant text := $pattern$id_verification_method[[:space:]]*=[[:space:]]*'CHALLENGE_VIDEO'$pattern$;
begin
  -- The refresh wrapper delegates decisions to the preserved implementation.
  -- Older environments may still have the assignment in the public function.
  target_function := coalesce(
    to_regprocedure('public.ops_trust_exception_action_snapshot_v1(text,uuid,uuid,text,boolean,text,text,text,uuid,uuid,bigint,boolean,boolean)'),
    to_regprocedure('public.ops_trust_exception_action(text,uuid,uuid,text,boolean,text,text,text,uuid,uuid,bigint,boolean,boolean)')
  );
  if target_function is null then
    raise exception 'Recruitment waiver decision function unavailable';
  end if;
  select pg_get_functiondef(target_function) into definition;

  if definition is null or definition !~ old_method then
    raise exception 'Expected recruitment waiver verification method assignment unavailable';
  end if;

  definition := regexp_replace(
    definition,
    old_method,
    'id_verification_method = ''ADMIN_RECRUITMENT_WAIVER'''
  );

  if definition ~ old_method or definition !~ $pattern$id_verification_method[[:space:]]*=[[:space:]]*'ADMIN_RECRUITMENT_WAIVER'$pattern$ then
    raise exception 'Recruitment waiver method replacement did not produce the expected function';
  end if;

  execute definition;
end;
$$;
