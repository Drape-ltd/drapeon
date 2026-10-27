do $rollback$
begin
  if exists (
    select 1 from public.payment_routes where status = 'ENABLED'
  ) then
    raise exception 'Cannot roll back route fee evidence while any payment route is enabled';
  end if;
end
$rollback$;

drop trigger if exists payment_routes_fee_evidence_enable_guard on public.payment_routes;
drop trigger if exists payment_route_approvals_fee_evidence_guard on public.payment_route_approvals;

drop function if exists private.guard_payment_route_fee_evidence_on_enable();
drop function if exists private.guard_payment_route_fee_evidence();
