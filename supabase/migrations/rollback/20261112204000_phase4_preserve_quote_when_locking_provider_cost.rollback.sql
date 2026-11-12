-- Rehearsal rollback. The preceding 20261112203000 migration recreates this
-- wrapper when the forward chain is reapplied.
drop function if exists public.accept_active_order_quote_with_route_snapshot_v2(
  text, uuid, uuid, integer, uuid, integer, uuid, integer, uuid, text, text
);
