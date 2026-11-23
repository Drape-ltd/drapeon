-- P0: SECURITY DEFINER functions are PUBLIC-executable by default in Postgres.
-- These routines are trigger/service internals and accept caller-controlled order
-- or inventory identifiers, so they must never be exposed through PostgREST RPC.
-- Keep the service role path explicit for Edge/internal callers.

revoke execute on function public.finalize_order_terminal(
  uuid, text, text, text, text, text, jsonb, text[], text, boolean, boolean, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.finalize_order_terminal(
  uuid, text, text, text, text, text, jsonb, text[], text, boolean, boolean, boolean, boolean
) to service_role;

revoke execute on function public.reserve_seller_item_inventory(uuid, integer) from public, anon, authenticated;
revoke execute on function public.reserve_seller_item_inventory(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.release_seller_item_inventory(uuid, integer) from public, anon, authenticated;
revoke execute on function public.release_seller_item_inventory(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_seller_item_inventory(uuid, integer) to service_role;
grant execute on function public.reserve_seller_item_inventory(uuid, integer, text) to service_role;
grant execute on function public.release_seller_item_inventory(uuid, integer) to service_role;
grant execute on function public.release_seller_item_inventory(uuid, integer, text) to service_role;

