do $$
declare
  v_definition text := pg_get_functiondef(
    'public.reserve_settlement_tranche_payout_row(uuid,text,uuid,text,text,text,text)'::regprocedure
  );
begin
  if position('v_destination.currency::text is distinct from v_order.tailor_payout_currency_locked::text' in v_definition)=0 then
    raise exception 'Tranche reservation still compares text to the currency enum';
  end if;
  if position('v_destination.currency::text is distinct from v_order.tailor_payout_currency_locked ' in v_definition)>0 then
    raise exception 'Tranche reservation retains the invalid text/enum comparison';
  end if;
end;
$$;
