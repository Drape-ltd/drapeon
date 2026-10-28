-- Restore the pre-hardening service_role grants from the applied Phase 2
-- migrations. Client roles remain revoked; only Phase 2 server-role grants are
-- restored. This rollback does not alter data or RLS policies.

grant insert, references, select, trigger, truncate, update on public.payment_routes,
  public.delivery_country_rules,
  public.payout_destinations
to service_role;

grant references, select, trigger, truncate on public.payment_route_approvals to service_role;
grant insert, references, select, trigger, truncate on public.payment_route_audit_events,
  public.delivery_country_audit_events
to service_role;
grant delete, references, select, trigger, truncate, update on public.payout_destination_review_events to service_role;
