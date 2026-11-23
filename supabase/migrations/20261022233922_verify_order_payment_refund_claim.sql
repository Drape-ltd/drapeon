do $$
declare
  v_function regprocedure := to_regprocedure(
    'public.reserve_order_payment_refund_claim(uuid,text,public.order_payment_phase,public.payment_provider,text,text,integer)');
begin
  if to_regclass('public.order_payment_refund_claims') is null or v_function is null then
    raise exception 'Payment refund claim contract is missing';
  end if;
  if not (select relrowsecurity from pg_class
      where oid='public.order_payment_refund_claims'::regclass) then
    raise exception 'Payment refund claims require RLS';
  end if;
  if has_table_privilege('anon','public.order_payment_refund_claims','SELECT')
    or has_table_privilege('authenticated','public.order_payment_refund_claims','SELECT')
    or has_function_privilege('anon',v_function,'EXECUTE')
    or has_function_privilege('authenticated',v_function,'EXECUTE')
    or not has_function_privilege('service_role',v_function,'EXECUTE') then
    raise exception 'Payment refund claim grants are unsafe';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.order_payment_refund_claims'::regclass
      and contype='u' and pg_get_constraintdef(oid) like '%(payment_id, refunded_before)%'
  ) then
    raise exception 'Exact refund position uniqueness is missing';
  end if;
end;
$$;
