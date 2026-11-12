-- Rehearsal rollback. The preceding 20261112201000 migration recreates the
-- wrappers when the forward chain is reapplied.
drop function if exists public.accept_active_order_quote_with_route_snapshot_v2(
  text, uuid, uuid, integer, uuid, integer, uuid, integer, uuid, text, text
);
drop function if exists public.snapshot_ready_made_payment_route_v2(
  text, uuid, uuid, integer, uuid, integer, uuid, text, text
);
