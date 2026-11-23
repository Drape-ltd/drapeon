-- Never discard a provider identifier after a claim exists.
do $$ begin
  if exists (select 1 from public.tip_money_operation_claims limit 1) then
    raise exception 'Tip claims exist; roll forward rather than narrowing the provider column';
  end if;
end $$;

alter table public.tip_money_operation_claims
  drop constraint tip_money_operation_claims_provider_nonempty;
alter table public.tip_money_operation_claims
  alter column provider type public.payment_provider using provider::public.payment_provider;
