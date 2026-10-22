-- One tip payment may create one payout business object, regardless of status.
-- Retries create attempts beneath the same claim; they must never insert a
-- second pending payout while a provider response is unknown.
do $$
begin
  if exists (
    select 1 from public.payouts
    where payout_purpose = 'TIP' and source_payment_id is not null
    group by source_payment_id having count(*) > 1
  ) then
    raise exception 'Duplicate tip payouts must be reconciled before enforcing the business key';
  end if;
end;
$$;

create unique index payouts_tip_source_payment_unique_idx
  on public.payouts(source_payment_id)
  where payout_purpose = 'TIP' and source_payment_id is not null;
