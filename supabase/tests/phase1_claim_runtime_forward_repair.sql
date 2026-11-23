do $$
begin
  if to_regprocedure('public.reserve_payout_claim(text,text,text,text,text,text,text,public.currency,integer,text,text,text,text)') is null
    or to_regprocedure('public.block_payout_claim_identity_conflict(uuid,jsonb)') is null
    or to_regprocedure('public.block_confirmed_payout_identity_conflict(uuid,jsonb)') is null
    or to_regprocedure('public.reserve_order_payment_refund_claim(uuid,text,public.order_payment_phase,public.payment_provider,text,text,integer)') is null then
    raise exception 'A Phase 1 claim runtime function is missing';
  end if;

  if has_function_privilege('anon', 'public.reserve_payout_claim(text,text,text,text,text,text,text,public.currency,integer,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.reserve_payout_claim(text,text,text,text,text,text,text,public.currency,integer,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.reserve_order_payment_refund_claim(uuid,text,public.order_payment_phase,public.payment_provider,text,text,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.reserve_order_payment_refund_claim(uuid,text,public.order_payment_phase,public.payment_provider,text,text,integer)', 'EXECUTE') then
    raise exception 'A claim reservation RPC is executable by a client role';
  end if;

  if not has_function_privilege('service_role', 'public.reserve_payout_claim(text,text,text,text,text,text,text,public.currency,integer,text,text,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.block_payout_claim_identity_conflict(uuid,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.block_confirmed_payout_identity_conflict(uuid,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.reserve_order_payment_refund_claim(uuid,text,public.order_payment_phase,public.payment_provider,text,text,integer)', 'EXECUTE') then
    raise exception 'service_role cannot execute a required claim RPC';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.reserve_payout_claim(text,text,text,text,text,text,text,public.currency,integer,text,text,text,text)'::regprocedure,
      'public.block_payout_claim_identity_conflict(uuid,jsonb)'::regprocedure,
      'public.block_confirmed_payout_identity_conflict(uuid,jsonb)'::regprocedure,
      'public.reserve_order_payment_refund_claim(uuid,text,public.order_payment_phase,public.payment_provider,text,text,integer)'::regprocedure
    )
    and not ('search_path=""' = any(coalesce(p.proconfig, array[]::text[])))
  ) then
    raise exception 'A claim RPC does not pin an empty search_path';
  end if;
end;
$$;
