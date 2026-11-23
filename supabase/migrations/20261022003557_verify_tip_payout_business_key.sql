do $$
begin
  if not exists (
    select 1 from pg_indexes where schemaname='public' and tablename='payouts'
      and indexname='payouts_tip_source_payment_unique_idx'
      and indexdef like '%UNIQUE INDEX%'
  ) then raise exception 'All-status tip payout business key is missing'; end if;
  if exists (
    select 1 from public.payouts where payout_purpose='TIP' and source_payment_id is not null
    group by source_payment_id having count(*)>1
  ) then raise exception 'Duplicate tip payout business key detected'; end if;
end;
$$;
