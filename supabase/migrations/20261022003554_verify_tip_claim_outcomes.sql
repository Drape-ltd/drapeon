do $$
begin
  if not has_function_privilege('service_role', 'public.record_tip_money_operation_outcome(uuid,text,text,text,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.record_tip_money_operation_outcome(uuid,text,text,text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.record_tip_money_operation_outcome(uuid,text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'Tip claim outcome function permissions are unsafe';
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid='public.tip_money_operation_claims'::regclass
      and conname='tip_money_operation_terminal_evidence'
  ) then raise exception 'Terminal tip claim evidence constraint is missing'; end if;
end;
$$;
