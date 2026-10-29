-- A Bachs checkout (chk_) is created before any charge (ch_) exists. Preserve
-- both IDs: webhook matching uses the immutable checkout ID, while refunds and
-- reconciliation use the eventual charge ID. Do not replace the checkout ID.
alter table public.order_payments
  add column if not exists provider_charge_id text;

create unique index if not exists order_payments_provider_charge_id_idx
  on public.order_payments(provider, provider_charge_id)
  where provider_charge_id is not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_payments'::regclass
      and conname = 'order_payments_bachs_charge_id_shape'
  ) then
    alter table public.order_payments
      add constraint order_payments_bachs_charge_id_shape
      check (provider <> 'BACHS' or provider_charge_id is null or provider_charge_id like 'ch_%')
      not valid;
  end if;
end $$;

alter table public.order_payments
  validate constraint order_payments_bachs_charge_id_shape;
