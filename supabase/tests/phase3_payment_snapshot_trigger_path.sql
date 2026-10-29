do $$
declare
  v_fn regprocedure := to_regprocedure('public.copy_payment_tax_decision_snapshot()');
  v_config text[];
  v_security_definer boolean;
  v_trigger_count integer;
begin
  if v_fn is null then raise exception 'Payment snapshot trigger function is missing'; end if;

  select proconfig, prosecdef into v_config, v_security_definer
  from pg_proc where oid = v_fn;
  if v_security_definer or not coalesce(v_config @> array['search_path=""'], false) then
    raise exception 'Payment snapshot trigger must be SECURITY INVOKER with an empty search_path';
  end if;

  if has_function_privilege('anon', v_fn, 'EXECUTE')
    or has_function_privilege('authenticated', v_fn, 'EXECUTE')
    or has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'Payment snapshot trigger must not be directly executable by API roles';
  end if;

  select count(*) into v_trigger_count from pg_trigger
  where tgfoid = v_fn and tgname = 'order_payment_tax_decision_snapshot'
    and tgrelid = 'public.order_payments'::regclass and not tgisinternal and tgenabled = 'O';
  if v_trigger_count <> 1 then raise exception 'Payment tax snapshot trigger is missing or disabled'; end if;
end;
$$;
