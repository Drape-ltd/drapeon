do $$
begin
  if exists (select 1 from public.bachs_withdrawal_destinations
             where payout_change_request_id is not null
               and ops_review_status='CLEARED') then
    raise exception 'BACHS_WITHDRAWAL_OPS_REVIEW_IN_USE';
  end if;
end $$;
drop function public.ops_finalize_bachs_withdrawal_change(uuid,uuid,text,text,text);
