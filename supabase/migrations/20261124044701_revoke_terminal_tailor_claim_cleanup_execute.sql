-- Development-only hardening. This trigger function must never be callable by
-- Data API roles; the trigger remains executable by its owning database role.
revoke execute on function public.cleanup_terminal_tailor_claim_provider_identity()
  from public, anon, authenticated;
