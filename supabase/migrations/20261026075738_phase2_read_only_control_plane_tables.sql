-- Route and delivery configuration mutations must go through their audited
-- SECURITY DEFINER Ops RPCs. Approval and route audit rows are likewise written
-- by those RPCs/triggers, never by a raw service-role table request. Stripe
-- destination synchronization remains the only direct config-table writer.

revoke all on public.payment_routes,
  public.delivery_country_rules,
  public.payment_route_approvals,
  public.payment_route_audit_events,
  public.delivery_country_audit_events
from service_role;

grant select on public.payment_routes,
  public.delivery_country_rules,
  public.payment_route_approvals,
  public.payment_route_audit_events,
  public.delivery_country_audit_events
to service_role;
