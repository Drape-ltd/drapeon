-- Fail closed between rollback steps. The paired feature rollback recreates and
-- re-grants the original claim function.
revoke execute on function public.claim_bachs_checkout_request(uuid, text)
  from service_role;
revoke execute on function public.reject_bachs_checkout_request(uuid, text, integer, text, text[])
  from service_role;
