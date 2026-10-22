do $$
declare
  v_function regprocedure := to_regprocedure(
    'public.record_order_payment_refund_claim_outcome(uuid,public.payment_provider,text,text,jsonb)');
begin
  if v_function is null
    or to_regprocedure('public.guard_order_payment_refund_claim_status()') is null
    or not exists (
      select 1 from pg_trigger
      where tgrelid='public.order_payment_refund_claims'::regclass
        and tgname='order_payment_refund_claim_status_guard'
        and not tgisinternal
    ) then
    raise exception 'Refund claim outcome contract is missing';
  end if;
  if has_function_privilege('anon',v_function,'EXECUTE')
    or has_function_privilege('authenticated',v_function,'EXECUTE')
    or not has_function_privilege('service_role',v_function,'EXECUTE') then
    raise exception 'Refund claim outcome grants are unsafe';
  end if;
end;
$$;
