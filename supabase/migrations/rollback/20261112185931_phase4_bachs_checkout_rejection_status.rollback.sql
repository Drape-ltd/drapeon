-- Fail closed between rollback steps. The preceding rollback restores the
-- earlier definitions before the feature rollback removes the substate.
revoke execute on function public.claim_bachs_checkout_request(uuid, text)
  from service_role;
revoke execute on function public.reject_bachs_checkout_request(uuid, text, integer, text, text[])
  from service_role;
