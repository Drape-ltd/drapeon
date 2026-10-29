do $$
declare v_definition text;
begin
  if to_regprocedure('public.finalize_claimed_tip_refund(uuid,uuid,text)') is null then
    raise exception 'finalize_claimed_tip_refund function is missing';
  end if;
  if not has_function_privilege('service_role', 'public.finalize_claimed_tip_refund(uuid,uuid,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.finalize_claimed_tip_refund(uuid,uuid,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.finalize_claimed_tip_refund(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'finalize_claimed_tip_refund grants are unsafe';
  end if;
  select pg_get_functiondef('public.finalize_claimed_tip_refund(uuid,uuid,text)'::regprocedure)
    into v_definition;
  if position('for update' in lower(v_definition)) = 0
    or position('commercial_ledger_transactions' in v_definition) = 0
    or position('TIP_REFUNDED' in v_definition) = 0 then
    raise exception 'finalize_claimed_tip_refund invariants are missing';
  end if;
end;
$$;
