-- Restore the grants left by 20261026075107. Mutations still remain confined to
-- the established Ops RPCs in normal application code; this rollback only
-- restores the previous service_role table privileges for emergency rollback.

grant select, insert, update on public.payment_routes,
  public.delivery_country_rules
to service_role;

grant select, insert on public.payment_route_approvals,
  public.payment_route_audit_events,
  public.delivery_country_audit_events
to service_role;
