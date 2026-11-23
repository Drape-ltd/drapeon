do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.order_payment_refund_claims'::regclass
      and tgname='order_payment_refund_claim_identity_guard'
      and not tgisinternal
  ) or to_regprocedure('public.guard_order_payment_refund_claim_identity()') is null then
    raise exception 'Refund claim identity guard missing';
  end if;
  if has_function_privilege('anon',
      'public.guard_order_payment_refund_claim_identity()','EXECUTE')
    or has_function_privilege('authenticated',
      'public.guard_order_payment_refund_claim_identity()','EXECUTE') then
    raise exception 'Refund claim guard must not be client-callable';
  end if;
end;
$$;
