-- Production-shaped UUID repair for the customer refund receipt RPC.
-- The historical 20261110031000 body compares text ledger order IDs to UUID
-- order IDs. Development uses text order IDs and already has that function.
do $migration$
declare
  v_order_id_type oid;
  v_customer_id_type oid;
  v_payment_order_id_type oid;
  v_ledger_order_id_type oid;
begin
  select atttypid into v_order_id_type from pg_attribute
    where attrelid='public.orders'::regclass and attname='id' and not attisdropped;
  select atttypid into v_customer_id_type from pg_attribute
    where attrelid='public.orders'::regclass and attname='customer_id' and not attisdropped;
  select atttypid into v_payment_order_id_type from pg_attribute
    where attrelid='public.order_payments'::regclass and attname='order_id' and not attisdropped;
  select atttypid into v_ledger_order_id_type from pg_attribute
    where attrelid='public.commercial_ledger_transactions'::regclass
      and attname='order_id' and not attisdropped;

  if v_order_id_type='text'::regtype and v_customer_id_type='text'::regtype
     and v_payment_order_id_type='text'::regtype
     and v_ledger_order_id_type='text'::regtype then
    if to_regprocedure('public.list_customer_order_refund_receipts(text)') is null then
      raise exception 'S2_DEV_REFUND_RECEIPT_RPC_MISSING';
    end if;
    return;
  end if;

  if v_order_id_type is distinct from 'uuid'::regtype
     or v_customer_id_type is distinct from 'uuid'::regtype
     or v_payment_order_id_type is distinct from 'uuid'::regtype
     or v_ledger_order_id_type is distinct from 'text'::regtype
     or to_regclass('public.order_payment_provider_refunds') is null then
    raise exception 'S2_REFUND_RECEIPT_ID_TYPE_OR_TABLE_DRIFT';
  end if;

  execute $ddl$
    create or replace function public.list_customer_order_refund_receipts(p_order_id text)
    returns table (
      refund_reference text,
      amount_minor integer,
      currency text,
      refund_status text,
      recorded_at timestamptz
    )
    language plpgsql stable security definer set search_path to ''
    as $body$
    begin
      -- Preserve the old RPC's empty result for malformed text IDs.
      if p_order_id is null or p_order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return;
      end if;

      return query
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
        where t.order_id = o.id::text
          and t.payment_id = p.id
          and t.transaction_kind = 'REFUND'
          and t.provider_reference = r.provider_refund_id
          and t.original_amount = r.amount
        order by t.occurred_at desc
        limit 1
      ) journal on true
      where o.id = p_order_id::uuid
        and o.customer_id = auth.uid()
      order by coalesce(journal.occurred_at, r.updated_at, r.created_at) desc, r.id;
    end;
    $body$;
  $ddl$;

  revoke all on function public.list_customer_order_refund_receipts(text)
    from public, anon;
  grant execute on function public.list_customer_order_refund_receipts(text)
    to authenticated;
  comment on function public.list_customer_order_refund_receipts(text) is
    'Customer-only refund records from provider refunds and matching ledger journals; UUID orders, text ledger bridge.';
end;
$migration$;
