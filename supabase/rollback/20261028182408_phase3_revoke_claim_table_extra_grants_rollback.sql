-- Restore only the application grants (not the old project's blanket default
-- grants) if this forward privilege repair is intentionally rolled back.
grant select, insert, update on table
  public.payout_claims,
  public.payout_attempts,
  public.order_payment_refund_claims,
  public.payout_provider_operations,
  public.bachs_account_setup_claims,
  public.order_payment_refund_attempts
to service_role;

grant select on table public.provider_payment_settlement_checks to service_role;
