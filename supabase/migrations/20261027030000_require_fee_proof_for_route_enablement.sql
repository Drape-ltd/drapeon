-- A route cannot be enabled on generic fee-policy labels alone. Each named
-- approver must reference both the customer-facing disclosure proof and the
-- settled-net reconciliation proof. This migration does not change any price.

create or replace function private.guard_payment_route_fee_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.approval_kind = 'ENABLE_ROUTE' and (
    length(trim(coalesce(new.evidence ->> 'customer_fee_disclosure', ''))) not between 1 and 500
    or length(trim(coalesce(new.evidence ->> 'settlement_fee_reconciliation', ''))) not between 1 and 500
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'payment_route_fee_evidence_required',
      message = 'Route approval requires customer fee disclosure and settled-net reconciliation evidence';
  end if;
  return new;
end
$function$;

create trigger payment_route_approvals_fee_evidence_guard
before insert or update on public.payment_route_approvals
for each row execute function private.guard_payment_route_fee_evidence();

create or replace function private.guard_payment_route_fee_evidence_on_enable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_approver_count integer;
  v_fee_evidence_complete boolean;
begin
  if new.status is distinct from old.status and new.status = 'ENABLED' then
    select count(distinct coalesce(
        approval.approver_workforce_principal_id::text,
        approval.approver_id::text
      )),
      coalesce(bool_and(
        length(trim(coalesce(approval.evidence ->> 'customer_fee_disclosure', ''))) between 1 and 500
        and length(trim(coalesce(approval.evidence ->> 'settlement_fee_reconciliation', ''))) between 1 and 500
      ), false)
    into v_approver_count, v_fee_evidence_complete
    from public.payment_route_approvals approval
    where approval.route_id = new.id
      and approval.enablement_request_id = new.active_enablement_request_id
      and approval.approval_kind = 'ENABLE_ROUTE';

    if v_approver_count < 2 or not v_fee_evidence_complete then
      raise exception using
        errcode = '23514',
        constraint = 'payment_routes_fee_evidence_required',
        message = 'Route enablement requires two approvals with customer fee disclosure and settled-net reconciliation evidence';
    end if;
  end if;
  return new;
end
$function$;

create trigger payment_routes_fee_evidence_enable_guard
before update of status on public.payment_routes
for each row execute function private.guard_payment_route_fee_evidence_on_enable();

revoke all on function private.guard_payment_route_fee_evidence() from public, anon, authenticated;
revoke all on function private.guard_payment_route_fee_evidence_on_enable() from public, anon, authenticated;
grant execute on function private.guard_payment_route_fee_evidence() to service_role;
grant execute on function private.guard_payment_route_fee_evidence_on_enable() to service_role;
