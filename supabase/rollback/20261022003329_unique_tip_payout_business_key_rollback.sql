do $$ begin
  if exists (select 1 from public.tip_money_operation_claims limit 1) then
    raise exception 'Tip claims exist; roll forward rather than removing the payout uniqueness guard';
  end if;
end $$;

drop index public.payouts_tip_source_payment_unique_idx;
