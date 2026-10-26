-- Keep Phase 2 tables usable only through the explicit server-side APIs and
-- required readers. Supabase's existing default grants include privileges such
-- as TRUNCATE/REFERENCES; do not leave those on route/configuration tables.
-- The first-withdrawal audit is written only by its SECURITY DEFINER review RPC.

revoke all on public.payment_routes,
  public.delivery_country_rules,
  public.payout_destinations,
  public.payment_route_approvals,
  public.payment_route_audit_events,
  public.delivery_country_audit_events,
  public.payout_destination_review_events
from public, anon, authenticated, service_role;

grant select, insert, update on public.payment_routes,
  public.delivery_country_rules,
  public.payout_destinations
to service_role;

grant select, insert on public.payment_route_approvals,
  public.payment_route_audit_events,
  public.delivery_country_audit_events
to service_role;

grant select on public.payout_destination_review_events to service_role;
