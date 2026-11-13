-- Roll back only the unused disabled Phase 4 route seed. Refuse to remove a
-- route that has accumulated acceptance, destination or enablement evidence.

do $rollback$
declare
  v_route_id constant uuid := 'b4c80000-0000-4000-8000-000000000001'::uuid;
  v_seed_reason constant text :=
    'Phase 4 reviewed Production seed; route remains disabled pending live proof and two-person enablement';
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

  -- Route creation is audited by a restrictive foreign key. Remove only the
  -- exact receipt produced by this seed, and refuse if any later route history
  -- exists. This keeps rollback scoped to a route that was never used.
  if (select count(*) from public.payment_route_audit_events where route_id = v_route_id) <> 1
    or not exists (
      select 1
      from public.payment_route_audit_events
      where route_id = v_route_id
        and actor_id is null
        and actor_workforce_principal_id =
          '00000000-0000-4000-8000-000000000004'::uuid
        and action = 'CREATED'
        and previous_status is null
        and new_status = 'DISABLED'
        and reason = v_seed_reason
        and evidence = '{}'::jsonb
    ) then
    raise exception 'Refusing to remove a Bachs route with non-seed audit history';
  end if;

  delete from public.payment_route_audit_events
  where route_id = v_route_id
    and action = 'CREATED'
    and reason = v_seed_reason;

  delete from public.audit_logs
  where actor_id = 'phase4-production-migration'
    and actor_role = 'SYSTEM'
    and event = 'payments.phase4_bachs_ngn_route_seeded'
    and severity = 'notice'
    and payload = jsonb_build_object(
      'route_id', v_route_id,
      'route_key', 'ng-ngn-ngn-bachs',
      'version', 1,
      'status', 'DISABLED',
      'money_enabled', false
    );

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

