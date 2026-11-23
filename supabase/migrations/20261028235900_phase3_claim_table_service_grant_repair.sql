-- The claim-table foundation inherited the default full service_role ACL.
-- Keep only the privileges its writers use. RLS stays enabled and no client
-- role receives table privileges.
revoke all on public.consultation_money_operation_claims,
  public.consultation_refund_holds,
  public.adjustment_money_operation_claims from service_role;

grant select, insert, update on public.consultation_money_operation_claims,
  public.consultation_refund_holds,
  public.adjustment_money_operation_claims to service_role;
