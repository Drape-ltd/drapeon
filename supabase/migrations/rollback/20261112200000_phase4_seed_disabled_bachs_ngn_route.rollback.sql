-- Roll back only the unused disabled Phase 4 route seed. Refuse to remove a
-- route that has accumulated acceptance, destination or enablement evidence.

do $rollback$
declare
  v_route_id constant uuid := 'b4c80000-0000-4000-8000-000000000001'::uuid;
begin
  if exists (
    select 1
    from public.payment_routes
    where id = v_route_id
      and (
        status <> 'DISABLED'
        or active_enablement_request_id is not null
      )
  ) then
    raise exception 'Refusing to remove a Bachs route that is no longer disabled';
  end if;

  if exists (select 1 from public.orders where payment_route_id = v_route_id)
    or exists (select 1 from public.payment_route_enablement_requests where route_id = v_route_id)
    or exists (select 1 from public.payment_route_approvals where route_id = v_route_id) then
    raise exception 'Refusing to remove a Bachs route with dependent evidence';
  end if;

  -- The immutable configuration trigger intentionally blocks arbitrary
  -- deletion. The rollback disables only that trigger for this exact row and
  -- re-enables it in the same transaction.
  alter table public.payment_routes disable trigger payment_routes_audit_guard;
  delete from public.payment_routes
  where id = v_route_id
    and route_key = 'ng-ngn-ngn-bachs'
    and version = 1
    and status = 'DISABLED';
  alter table public.payment_routes enable trigger payment_routes_audit_guard;
end
$rollback$;

