do $$
begin
  if exists (select 1 from public.bachs_withdrawal_destinations
             where payout_change_request_id is not null or status <> 'CURRENT') then
    raise exception 'BACHS_WITHDRAWAL_BACKFILL_IN_USE';
  end if;
end $$;
delete from public.bachs_withdrawal_destinations
where decision_reason = 'ORIGINAL_ONBOARDING_BACKFILL';
