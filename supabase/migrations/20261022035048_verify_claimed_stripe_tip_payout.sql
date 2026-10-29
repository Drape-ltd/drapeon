do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.finalize_claimed_stripe_tip_payout(uuid,uuid,text,text,jsonb)'::regprocedure)
    into v_definition;
  if position('for update' in lower(v_definition))=0
    or position('post_commercial_ledger_transaction' in v_definition)=0
    or position('tip-payout-review:' in v_definition)=0 then
    raise exception 'Claimed Stripe tip finalizer is missing its atomic receipt or review guard';
  end if;
  if has_function_privilege('authenticated',
      'public.finalize_claimed_stripe_tip_payout(uuid,uuid,text,text,jsonb)', 'execute')
    or not has_function_privilege('service_role',
      'public.finalize_claimed_stripe_tip_payout(uuid,uuid,text,text,jsonb)', 'execute') then
    raise exception 'Claimed Stripe tip finalizer permissions are incorrect';
  end if;
end $$;
