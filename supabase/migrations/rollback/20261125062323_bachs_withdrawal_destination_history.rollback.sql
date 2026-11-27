do $$
begin
  if exists (select 1 from public.bachs_withdrawal_destinations
             where status <> 'CURRENT' or payout_change_request_id is not null
                or decision_reason <> 'ORIGINAL_ONBOARDING_BACKFILL') then
    raise exception 'BACHS_WITHDRAWAL_HISTORY_IN_USE';
  end if;
end $$;
drop table public.bachs_withdrawal_destinations;
drop function private.guard_bachs_withdrawal_destination_row();
