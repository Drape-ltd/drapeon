do $$
begin
  if to_regprocedure('public.bind_tip_payout_claim(uuid,text,text,text)') is null
    or to_regprocedure('public.start_tip_money_operation_provider_call(uuid)') is null then
    raise exception 'TIP payout claim runtime RPC is missing';
  end if;

  if has_function_privilege('anon', 'public.bind_tip_payout_claim(uuid,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.bind_tip_payout_claim(uuid,text,text,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.start_tip_money_operation_provider_call(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.start_tip_money_operation_provider_call(uuid)', 'EXECUTE') then
    raise exception 'TIP payout claim runtime RPC is executable by a client role';
  end if;

  if not has_function_privilege('service_role', 'public.bind_tip_payout_claim(uuid,text,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.start_tip_money_operation_provider_call(uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.record_tip_money_operation_outcome(uuid,text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'service_role cannot execute TIP payout claim runtime RPC';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.bind_tip_payout_claim(uuid,text,text,text)'::regprocedure,
      'public.start_tip_money_operation_provider_call(uuid)'::regprocedure,
      'public.record_tip_money_operation_outcome(uuid,text,text,text,jsonb)'::regprocedure
    )
    and not ('search_path=""' = any(coalesce(p.proconfig, array[]::text[])))
  ) then
    raise exception 'TIP payout claim runtime RPC does not pin an empty search_path';
  end if;

  if position('status=''PROVIDER_UNKNOWN''' in pg_get_functiondef(
      'public.start_tip_money_operation_provider_call(uuid)'::regprocedure))=0
    or position('''RECONCILE''' in pg_get_functiondef(
      'public.start_tip_money_operation_provider_call(uuid)'::regprocedure))=0 then
    raise exception 'TIP payout provider start gate does not fail closed for re-entry';
  end if;

  if position('late_success_after_failure' in pg_get_functiondef(
      'public.record_tip_money_operation_outcome(uuid,text,text,text,jsonb)'::regprocedure))=0
    or position('FAILED_RECONCILED' in pg_get_functiondef(
      'public.record_tip_money_operation_outcome(uuid,text,text,text,jsonb)'::regprocedure))=0 then
    raise exception 'TIP outcome RPC does not preserve evidenced late success';
  end if;
end;
$$;
