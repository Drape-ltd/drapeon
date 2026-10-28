-- Restore the pre-migration trigger-function ACLs if this repair is explicitly
-- rolled back. Existing triggers remain bound to these functions.
grant execute on function public.copy_payment_tax_decision_snapshot()
  to public, service_role;
grant execute on function public.enforce_payout_change_terminal_lifecycle()
  to public, service_role;
grant execute on function public.prevent_payout_destination_release_hold()
  to public, service_role;
grant execute on function public.sync_tailor_payout_currency_fields()
  to public, service_role;
