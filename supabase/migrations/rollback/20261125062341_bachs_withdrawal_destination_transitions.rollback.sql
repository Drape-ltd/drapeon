do $$
begin
  if exists (select 1 from public.bachs_withdrawal_destinations
             where status <> 'CURRENT' or payout_change_request_id is not null) then
    raise exception 'BACHS_WITHDRAWAL_TRANSITIONS_IN_USE';
  end if;
end $$;
drop function public.record_bachs_withdrawal_default_result(uuid,text,boolean,text);
drop function public.decide_bachs_withdrawal_destination(uuid,text,uuid,text,timestamptz,boolean);
drop function public.stage_bachs_withdrawal_destination(uuid,uuid,text,text,text,text,uuid,timestamptz);
drop function public.initialize_bachs_withdrawal_destination(uuid,text,text,text,text);
