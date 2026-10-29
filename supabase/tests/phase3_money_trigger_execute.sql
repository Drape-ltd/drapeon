do $$
declare
  v_signature text;
  v_trigger_name text;
  v_table_name text;
  v_fn regprocedure;
  v_trigger_count integer;
  v_is_trigger boolean;
  v_security_definer boolean;
begin
  for v_signature, v_trigger_name, v_table_name in
    select * from (values
      ('public.copy_payment_tax_decision_snapshot()', 'order_payment_tax_decision_snapshot', 'public.order_payments'),
      ('public.enforce_payout_change_terminal_lifecycle()', 'trg_enforce_payout_change_terminal_lifecycle', 'public.payout_change_requests'),
      ('public.prevent_payout_destination_release_hold()', 'trg_prevent_payout_destination_release_hold', 'public.tailor_profiles'),
      ('public.sync_tailor_payout_currency_fields()', 'trg_tailor_payout_currency_sync', 'public.tailor_profiles')
    ) as expected(signature, trigger_name, table_name)
  loop
    v_fn := to_regprocedure(v_signature);
    if v_fn is null then
      raise exception 'Expected trigger function % is missing', v_signature;
    end if;

    select p.prorettype = 'trigger'::regtype, p.prosecdef
      into v_is_trigger, v_security_definer
      from pg_proc p where p.oid = v_fn;
    if not v_is_trigger or v_security_definer then
      raise exception '% must remain a SECURITY INVOKER trigger function', v_signature;
    end if;

    if has_function_privilege('anon', v_fn, 'EXECUTE')
      or has_function_privilege('authenticated', v_fn, 'EXECUTE')
      or has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception '% must not be directly executable by API roles', v_signature;
    end if;

    select count(*) into v_trigger_count
      from pg_trigger t
      where t.tgfoid = v_fn
        and t.tgname = v_trigger_name
        and t.tgrelid = v_table_name::regclass
        and not t.tgisinternal
        and t.tgenabled = 'O';
    if v_trigger_count <> 1 then
      raise exception 'Expected enabled trigger %.% for %', v_table_name, v_trigger_name, v_signature;
    end if;
  end loop;
end;
$$;
