do $$
declare
  v_table regclass := to_regclass('public.order_payment_refund_attempts');
  v_reserve regprocedure := to_regprocedure('public.reserve_bachs_payment_refund_attempt(uuid)');
  v_record regprocedure := to_regprocedure('public.record_bachs_payment_refund_attempt_outcome(uuid,text,text,jsonb)');
  v_claim_guard regprocedure := to_regprocedure('public.guard_order_payment_refund_claim_status()');
  v_attempt_guard regprocedure := to_regprocedure('public.guard_order_payment_refund_attempt()');
begin
  if v_table is null or v_reserve is null or v_record is null or v_claim_guard is null or v_attempt_guard is null then
    raise exception 'Bachs refund-attempt schema or RPC is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = v_table) then
    raise exception 'Bachs refund-attempt table must have RLS enabled';
  end if;
  if not exists (
    select 1 from pg_index i
    where i.indrelid = v_table and i.indisunique
      and i.indexrelid::regclass::text = 'order_payment_refund_attempts_one_active_idx'
      and i.indnkeyatts = 1
      and pg_get_expr(i.indpred, i.indrelid) like '%RESERVED%PROVIDER_UNKNOWN%PROVIDER_PENDING%'
  ) then
    raise exception 'One-active-attempt partial unique index is missing';
  end if;
  if has_table_privilege('anon', v_table, 'SELECT')
    or has_table_privilege('authenticated', v_table, 'SELECT')
    or not has_table_privilege('service_role', v_table, 'SELECT') then
    raise exception 'Bachs refund-attempt table grants are unsafe';
  end if;
  if has_function_privilege('anon', v_reserve, 'EXECUTE')
    or has_function_privilege('authenticated', v_reserve, 'EXECUTE')
    or not has_function_privilege('service_role', v_reserve, 'EXECUTE')
    or has_function_privilege('anon', v_record, 'EXECUTE')
    or has_function_privilege('authenticated', v_record, 'EXECUTE')
    or not has_function_privilege('service_role', v_record, 'EXECUTE') then
    raise exception 'Bachs refund-attempt RPC grants are unsafe';
  end if;
  if (select prosecdef from pg_proc where oid = v_reserve)
    or (select prosecdef from pg_proc where oid = v_record)
    or not exists (select 1 from pg_trigger where tgrelid = v_table
      and tgname = 'order_payment_refund_attempt_guard' and not tgisinternal) then
    raise exception 'Bachs refund-attempt invoker guard contract is missing';
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_payment_refund_attempts'
      and column_name = 'provider_charge_id') then
    raise exception 'Bachs refund attempt must pin the settled charge ID';
  end if;
  if pg_get_functiondef(v_claim_guard) not like '%Refund claim identity is immutable%'
    or pg_get_functiondef(v_claim_guard) not like '%new.provider_refund_id is distinct from old.provider_refund_id%'
    or pg_get_functiondef(v_attempt_guard) not like '%new.provider_refund_id is distinct from old.provider_refund_id%' then
    raise exception 'Refund claim or attempt identity is not immutable';
  end if;
end;
$$;
