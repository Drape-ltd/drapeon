-- Local rehearsal only: restore the privileges present before the repair.
revoke all on public.consultation_money_operation_claims,
  public.consultation_refund_holds,
  public.adjustment_money_operation_claims from service_role;

grant all on public.consultation_money_operation_claims,
  public.consultation_refund_holds,
  public.adjustment_money_operation_claims to service_role;
