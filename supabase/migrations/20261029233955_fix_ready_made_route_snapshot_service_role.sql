-- ready-made-order-action uses the service-role client for this RPC, but the
-- function was SECURITY INVOKER while service_role intentionally has no broad
-- SELECT grants on payment_routes or payout_destinations. Keep the narrow RPC
-- boundary and execute its fully-qualified body with the owning role.
alter function public.snapshot_ready_made_payment_route(
  text, uuid, uuid, integer, uuid, integer, uuid, text, text
) security definer;

alter function public.snapshot_ready_made_payment_route(
  text, uuid, uuid, integer, uuid, integer, uuid, text, text
) set search_path = '';

revoke all on function public.snapshot_ready_made_payment_route(
  text, uuid, uuid, integer, uuid, integer, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.snapshot_ready_made_payment_route(
  text, uuid, uuid, integer, uuid, integer, uuid, text, text
) to service_role;

