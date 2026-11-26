-- Review downstream consumers before rollback. The Dev text-ID branch was a
-- no-op and must never delete Dev's pre-existing receipt RPC.
do $rollback$
declare
  v_order_id_type oid;
  v_rpc regprocedure := to_regprocedure('public.list_customer_order_refund_receipts(text)');
begin
  select atttypid into v_order_id_type from pg_attribute
    where attrelid='public.orders'::regclass and attname='id' and not attisdropped;
  if v_order_id_type='text'::regtype then return; end if;
  if v_order_id_type is distinct from 'uuid'::regtype then
    raise exception 'S2_REFUND_RECEIPT_ROLLBACK_ID_TYPE_DRIFT';
  end if;
  if v_rpc is null then return; end if;
  if coalesce(obj_description(v_rpc::oid, 'pg_proc'), '') not like
     '%UUID orders, text ledger bridge%' then
    raise exception 'S2_REFUND_RECEIPT_ROLLBACK_BODY_DRIFT';
  end if;
  drop function public.list_customer_order_refund_receipts(text);
end;
$rollback$;
