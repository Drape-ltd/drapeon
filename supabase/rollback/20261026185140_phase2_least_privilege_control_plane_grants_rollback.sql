-- Restore the pre-migration service-role table/view privileges. This is for
-- rollback only; it restores the broad default grants identified in Dev.
grant all privileges on public.ops_coverage_calendars,
  public.ops_queue_policies,
  public.payment_route_enablement_requests,
  public.payout_destination_corrections,
  public.order_payment_exposure_measurements
to service_role;

grant all privileges on public.payout_account_movement_summary to service_role;
