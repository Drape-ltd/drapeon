-- Development retains legacy text profile IDs; production may use UUIDs.
-- Forward-only correction preserving exact canonical identity binding.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.ops_trust_exception_action(text,uuid,uuid,text,boolean,text,text,text,uuid,uuid,bigint,boolean,boolean)'::regprocedure) into definition;
  if position('where id=p_profile_id for update' in definition)=0 then
    raise exception 'Expected exception profile identity predicate missing';
  end if;
  execute replace(definition,'where id=p_profile_id for update',
    'where id::text=p_profile_id::text for update');
end;
$$;
