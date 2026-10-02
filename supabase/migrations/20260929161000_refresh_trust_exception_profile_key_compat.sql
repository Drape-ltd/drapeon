-- Existing tailor profile keys differ across environments; compare canonical text.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.ops_trust_exception_action(text,uuid,uuid,text,boolean,text,text,text,uuid,uuid,bigint,boolean,boolean)'::regprocedure) into definition;
  if position('where id=p_profile_id;' in definition)=0 then
    raise exception 'Expected refresh profile lookup missing';
  end if;
  execute replace(definition,'where id=p_profile_id;','where id::text=p_profile_id::text;');
end;
$$;
