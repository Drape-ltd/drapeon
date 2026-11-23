-- Roll back only the Phase 2 configuration creation entry points.
--
-- Keep the workforce-aware guard replacements: existing audited route disable,
-- sandbox-only and delivery-country actions also rely on attribution to the named
-- Ops principal. Removing those guards here would silently break those controls.
-- Configuration rows and audit history are intentionally preserved.

revoke all on function public.ops_create_phase2_payment_route(uuid, text, integer, text, text, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.ops_create_phase2_delivery_country_rule(uuid, text, integer, boolean, boolean, boolean, boolean, boolean, text, text) from public, anon, authenticated, service_role;
revoke all on function public.ops_mark_payment_route_sandbox_only(uuid, uuid, text) from public, anon, authenticated, service_role;

drop function if exists public.ops_create_phase2_payment_route(uuid, text, integer, text, text, text, text, text, text, text);
drop function if exists public.ops_create_phase2_delivery_country_rule(uuid, text, integer, boolean, boolean, boolean, boolean, boolean, text, text);
drop function if exists public.ops_mark_payment_route_sandbox_only(uuid, uuid, text);
