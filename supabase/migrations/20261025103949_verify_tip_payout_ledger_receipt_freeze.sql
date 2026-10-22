do $$
declare
  v_definition text;
  v_security_definer boolean;
  v_config text[];
begin
  select pg_get_functiondef(p.oid), p.prosecdef, p.proconfig
    into v_definition, v_security_definer, v_config
    from pg_proc p
    where p.oid=to_regprocedure(
      'public.prevent_tip_payout_ledger_receipt_rewrite()'
    );

  if v_definition is null
    or position('Recorded tip payout journal cannot be rewritten' in v_definition)=0
    or v_security_definer is distinct from false
    or not ('search_path=public, pg_temp' = any(coalesce(v_config, '{}'::text[]))) then
    raise exception 'Tip payout receipt immutability guard is missing or unsafe';
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.tip_money_operation_claims'::regclass
      and t.tgname='tip_payout_ledger_receipt_immutable'
      and not t.tgisinternal
      and (t.tgtype & 16)=16
  ) then
    raise exception 'Tip payout receipt immutable trigger is missing';
  end if;

  if has_function_privilege(
       'anon','public.prevent_tip_payout_ledger_receipt_rewrite()','EXECUTE'
     ) or has_function_privilege(
       'authenticated','public.prevent_tip_payout_ledger_receipt_rewrite()','EXECUTE'
     ) then
    raise exception 'Tip payout receipt guard must not be directly executable by clients';
  end if;
end;
$$;
