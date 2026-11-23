-- These trigger-only guards are not RPCs. Remove the inherited PUBLIC
-- EXECUTE grant and any direct API-role access without changing trigger code.
revoke all on function public.copy_payment_tax_decision_snapshot()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_payout_change_terminal_lifecycle()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_payout_destination_release_hold()
  from public, anon, authenticated, service_role;
revoke all on function public.sync_tailor_payout_currency_fields()
  from public, anon, authenticated, service_role;
