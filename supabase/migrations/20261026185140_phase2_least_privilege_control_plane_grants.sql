-- Supabase's current project defaults grant broad privileges to service_role on
-- newly-created public relations. These Phase 2/Ops objects are server-read
-- surfaces; writes already run through audited SECURITY DEFINER RPCs/triggers.
-- Keep the service key able to read them, but remove direct data mutation and
-- DDL-like table privileges.

revoke all on public.ops_coverage_calendars,
  public.ops_queue_policies,
  public.payment_route_enablement_requests,
  public.payout_destination_corrections,
  public.order_payment_exposure_measurements
from public, anon, authenticated, service_role;

grant select on public.ops_coverage_calendars,
  public.ops_queue_policies,
  public.payment_route_enablement_requests,
  public.payout_destination_corrections,
  public.order_payment_exposure_measurements
to service_role;

revoke all on public.payout_account_movement_summary
from public, anon, authenticated, service_role;
grant select on public.payout_account_movement_summary to service_role;
