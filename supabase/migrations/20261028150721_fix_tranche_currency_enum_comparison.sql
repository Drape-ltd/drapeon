-- Forward-only type correction. The accepted order stores payout currency as
-- public.currency while payout destinations store it as text; compare the
-- canonical enum's text value to avoid a runtime operator error.
do $$
declare
  v_definition text;
  v_old text := 'v_destination.currency::text is distinct from v_order.tailor_payout_currency_locked';
  v_new text := 'v_destination.currency::text is distinct from v_order.tailor_payout_currency_locked::text';
begin
  select pg_get_functiondef(
    'public.reserve_settlement_tranche_payout_row(uuid,text,uuid,text,text,text,text)'::regprocedure
  ) into v_definition;
  if v_definition is null or position(v_old in v_definition)=0 then
    raise exception 'Tranche reservation definition differs from the reviewed currency comparison';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
end;
$$;
