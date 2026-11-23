do $$
declare v_definition text;
begin
  select pg_get_functiondef(
    'public.finalize_claimed_tip_refund(uuid,uuid,text)'::regprocedure
  ) into v_definition;
  if position('PENDING_PAYOUT' in v_definition)=0
    or position('p.provider_payout_id=v_tip.payout_provider_reference' in v_definition)=0
    or position('l.provider_reference=v_tip.payout_provider_reference' in v_definition)=0 then
    raise exception 'Post-payout tip refund lacks the exact transfer and ledger receipt';
  end if;
end $$;
