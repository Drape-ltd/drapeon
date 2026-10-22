do $$
declare v_wrapper text;
begin
  select pg_get_functiondef('public.finalize_claimed_stripe_tip_payout(uuid,uuid,text,text,jsonb)'::regprocedure)
    into v_wrapper;
  if position('finalize_claimed_stripe_tip_payout_core' in v_wrapper)=0
    or position('finalize_claimed_tip_refund' in v_wrapper)=0
    or position('tip-refund-repair:' in v_wrapper)=0 then
    raise exception 'Waiting tip refund completion wrapper is incomplete';
  end if;
  if not has_function_privilege('service_role',
      'public.finalize_claimed_stripe_tip_payout(uuid,uuid,text,text,jsonb)','execute')
    or has_function_privilege('authenticated',
      'public.finalize_claimed_stripe_tip_payout(uuid,uuid,text,text,jsonb)','execute') then
    raise exception 'Waiting tip refund wrapper permissions are incorrect';
  end if;
end $$;
