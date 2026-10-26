-- Roll back only after the Edge callers have been rolled back together and
-- before any order has accepted a route snapshot. Restoring the old RPC grant
-- is part of reverting this brick; the Phase 2 route schema itself is rolled
-- back separately with its own guarded script.

do $guard$
begin
  if exists (select 1 from public.orders where accepted_route_snapshot_at is not null) then
    raise exception 'Cannot roll back route acceptance after an order has snapshotted a route.';
  end if;
end;
$guard$;

drop trigger if exists orders_quote_acceptance_requires_route_snapshot on public.orders;
drop function if exists private.require_route_snapshot_for_quote_acceptance();
drop function if exists public.accept_active_order_quote_with_route_snapshot(
  text, uuid, uuid, integer, uuid, integer, uuid, integer, uuid, text, text
);

grant execute on function public.accept_active_order_quote(text, uuid, uuid, integer)
  to service_role;
