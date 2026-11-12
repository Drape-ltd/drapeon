-- Expose a minimal refund receipt to the customer without granting access
-- to provider responses or internal money-operation records.
create or replace function public.list_customer_order_refund_receipts(p_order_id text)
returns table (
  refund_reference text,
  amount_minor integer,
  currency text,
  refund_status text,
  recorded_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    'DRF-' || upper(replace(r.id::text, '-', '')),
    r.amount,
    p.currency::text,
    case
      when r.status = 'CONFIRMED' and journal.id is not null then 'COMPLETED'
      when r.status in ('FAILED', 'CANCELED') then 'FAILED'
      else 'PROCESSING'
    end,
    coalesce(journal.occurred_at, r.updated_at, r.created_at)
  from public.orders o
  join public.order_payments p on p.order_id = o.id
  join public.order_payment_provider_refunds r on r.payment_id = p.id
  left join lateral (
    select t.id, t.occurred_at
    from public.commercial_ledger_transactions t
    where t.order_id = o.id
      and t.payment_id = p.id
      and t.transaction_kind = 'REFUND'
      and t.provider_reference = r.provider_refund_id
      and t.original_amount = r.amount
    order by t.occurred_at desc
    limit 1
  ) journal on true
  where o.id = p_order_id
    and o.customer_id = auth.uid()::text
  order by coalesce(journal.occurred_at, r.updated_at, r.created_at) desc, r.id;
$$;

revoke all on function public.list_customer_order_refund_receipts(text) from public, anon;
grant execute on function public.list_customer_order_refund_receipts(text) to authenticated;

comment on function public.list_customer_order_refund_receipts(text) is
  'Customer-only refund records from provider refunds and matching ledger journals; never exposes raw provider IDs or Ops evidence.';
