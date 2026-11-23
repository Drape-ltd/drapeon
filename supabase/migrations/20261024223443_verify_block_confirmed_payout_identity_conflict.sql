do $$
declare
  v_body text;
begin
  select p.prosrc into v_body from pg_proc p
    where p.oid='public.block_confirmed_payout_identity_conflict(uuid,jsonb)'::regprocedure
      and not p.prosecdef;
  if v_body is null
    or position('for update' in lower(v_body))=0
    or position('status=''BLOCKED''' in v_body)=0
    or position('a.status=''SUCCEEDED''' in v_body)=0
    or position('money-desk' in v_body)=0
    or not has_function_privilege('service_role',
      'public.block_confirmed_payout_identity_conflict(uuid,jsonb)','EXECUTE')
    or has_function_privilege('anon',
      'public.block_confirmed_payout_identity_conflict(uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated',
      'public.block_confirmed_payout_identity_conflict(uuid,jsonb)','EXECUTE') then
    raise exception 'Confirmed-payout identity conflict guard is not installed safely';
  end if;
end $$;
