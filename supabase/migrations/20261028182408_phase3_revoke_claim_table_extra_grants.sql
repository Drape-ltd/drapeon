-- Keep server-side claim access to the operations used by the code, but remove
-- inherited destructive/DDL-related privileges from pre-cutoff projects.
revoke all on table
  public.payout_claims,
  public.payout_attempts,
  public.order_payment_refund_claims,
  public.payout_provider_operations,
  public.bachs_account_setup_claims,
  public.order_payment_refund_attempts,
  public.provider_payment_settlement_checks
from service_role;

grant select, insert, update on table
  public.payout_claims,
  public.payout_attempts,
  public.order_payment_refund_claims,
  public.payout_provider_operations,
  public.bachs_account_setup_claims,
  public.order_payment_refund_attempts
to service_role;

grant select on table public.provider_payment_settlement_checks to service_role;
