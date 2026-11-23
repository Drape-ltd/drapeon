do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.tip_money_operation_claims'::regclass) then
    raise exception 'Tip operation claims must have RLS enabled';
  end if;
  if has_table_privilege('anon', 'public.tip_money_operation_claims', 'INSERT')
    or has_table_privilege('authenticated', 'public.tip_money_operation_claims', 'UPDATE') then
    raise exception 'Clients must not write tip operation claims';
  end if;
  if has_function_privilege('anon', 'public.reserve_tip_money_operation(uuid,text,text,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.reserve_tip_money_operation(uuid,text,text,uuid)', 'EXECUTE') then
    raise exception 'Clients must not reserve tip operations';
  end if;
  if not has_function_privilege('service_role', 'public.reserve_tip_money_operation(uuid,text,text,uuid)', 'EXECUTE') then
    raise exception 'Service role must reserve tip operations';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tip_money_operation_claims'::regclass
      and contype = 'u' and pg_get_constraintdef(oid) like '%tip_id, operation_kind%'
  ) then
    raise exception 'One operation claim per tip and kind must be enforced';
  end if;
end;
$$;
