-- Run after the migration in a Dev BEGIN ... ROLLBACK transaction.
-- Uses an existing confirmed, journaled refund without naming a customer in Git.
do $$
declare
  v_order_id text;
  v_customer_id text;
  v_amount integer;
  v_receipt record;
begin
  select o.id, o.customer_id, r.amount into v_order_id, v_customer_id, v_amount
  from public.order_payment_provider_refunds r
  join public.order_payments p on p.id = r.payment_id
  join public.orders o on o.id = p.order_id
  join public.commercial_ledger_transactions t on t.order_id = o.id
    and t.payment_id = p.id and t.transaction_kind = 'REFUND'
    and t.provider_reference = r.provider_refund_id and t.original_amount = r.amount
  where r.status = 'CONFIRMED' and o.customer_id is not null
  limit 1;
  if v_order_id is null then raise exception 'No confirmed journaled refund fixture'; end if;

  perform set_config('request.jwt.claim.sub', v_customer_id, true);
  select * into v_receipt from public.list_customer_order_refund_receipts(v_order_id)
    where amount_minor = v_amount and refund_status = 'COMPLETED' limit 1;
  if v_receipt.refund_reference is null or v_receipt.refund_reference !~ '^DRF-[A-F0-9]{32}$' then
    raise exception 'Customer refund receipt missing or leaked provider reference';
  end if;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  if exists (select 1 from public.list_customer_order_refund_receipts(v_order_id)) then
    raise exception 'Refund receipt visible to another user';
  end if;
  if has_function_privilege('anon', 'public.list_customer_order_refund_receipts(text)', 'EXECUTE') then
    raise exception 'Anonymous execute grant exists';
  end if;
  raise notice 'PASS customer refund receipt and isolation';
end $$;
