-- Restore the Phase 2 route guard. This migration owns cleanup of its exact
-- system-seeded route after the guard has been restored.

create or replace function private.guard_payment_route_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid;
  v_workforce_actor_id uuid;
  v_reason text;
  v_approver_count integer;
  v_evidence_complete boolean;
begin
  v_actor_id := auth.uid();
  v_workforce_actor_id := nullif(current_setting('app.payment_route_actor_principal_id', true), '')::uuid;
  v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');

  if tg_op = 'INSERT' then
    if new.status <> 'DISABLED' or new.active_enablement_request_id is not null then
      raise exception using errcode = '23514', constraint = 'payment_routes_created_disabled', message = 'Payment routes must be created disabled';
    end if;
    if (v_actor_id is null and v_workforce_actor_id is null) or v_reason is null then
      raise exception using errcode = '23514', constraint = 'payment_routes_creation_audited', message = 'Route creation requires a named actor and reason';
    end if;
    new.created_by := coalesce(new.created_by, v_actor_id);
    return new;
  end if;

  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by
    or new.route_key is distinct from old.route_key
    or new.version is distinct from old.version
    or new.tailor_country_code is distinct from old.tailor_country_code
    or new.charge_currency is distinct from old.charge_currency
    or new.payout_currency is distinct from old.payout_currency
    or new.provider is distinct from old.provider
    or new.legal_entity is distinct from old.legal_entity
    or new.fees_collector is distinct from old.fees_collector
    or new.fee_schedule_version is distinct from old.fee_schedule_version
    or new.confirmed_card_issuer_countries is distinct from old.confirmed_card_issuer_countries then
    raise exception using errcode = '23514', constraint = 'payment_routes_versioned_config_immutable', message = 'Payment route configuration is immutable; create a new version';
  end if;

  if new.status is distinct from old.status then
    if (v_actor_id is null and v_workforce_actor_id is null) or v_reason is null then
      raise exception using errcode = '23514', constraint = 'payment_routes_status_change_audited', message = 'Route status changes require a named actor and reason';
    end if;
    if new.status = 'ENABLED' then
      if new.active_enablement_request_id is null or not exists (
        select 1 from public.payment_route_enablement_requests as request
        where request.id = new.active_enablement_request_id
          and request.route_id = new.id and request.status = 'OPEN'
      ) then
        raise exception using errcode = '23514', constraint = 'payment_routes_enablement_request_required', message = 'Route enablement requires an open approval request';
      end if;
      select count(distinct coalesce(approval.approver_workforce_principal_id::text, approval.approver_id::text)),
        coalesce(bool_and(
          nullif(trim(approval.evidence ->> 'collection'), '') is not null
          and nullif(trim(approval.evidence ->> 'settlement'), '') is not null
          and nullif(trim(approval.evidence ->> 'transfer'), '') is not null
          and nullif(trim(approval.evidence ->> 'tailor_withdrawal'), '') is not null
          and (new.provider <> 'BACHS' or nullif(trim(approval.evidence ->> 'provider_confirmation'), '') is not null)
        ), false)
      into v_approver_count, v_evidence_complete
      from public.payment_route_approvals as approval
      where approval.route_id = new.id
        and approval.enablement_request_id = new.active_enablement_request_id
        and approval.approval_kind = 'ENABLE_ROUTE';
      if v_approver_count < 2 or not v_evidence_complete then
        raise exception using errcode = '23514', constraint = 'payment_routes_two_approver_evidence_required', message = 'Route enablement requires two distinct approvers and complete evidence';
      end if;
    else
      new.active_enablement_request_id := null;
    end if;
    new.updated_at := now();
  elsif new.active_enablement_request_id is distinct from old.active_enablement_request_id then
    raise exception using errcode = '23514', constraint = 'payment_routes_request_changes_with_status', message = 'Payment route approval request can change only with an audited status change';
  elsif new.updated_at is distinct from old.updated_at then
    raise exception using errcode = '23514', constraint = 'payment_routes_updated_at_managed', message = 'Payment route update timestamp is managed by the database';
  end if;
  return new;
end
$function$;

revoke all on function private.guard_payment_route_change() from public, anon, authenticated;
grant execute on function private.guard_payment_route_change() to service_role;

do $rollback$
declare
  v_route_id constant uuid := 'b4c80000-0000-4000-8000-000000000001'::uuid;
  v_seed_reason constant text :=
    'Phase 4 reviewed Production seed; route remains disabled pending live proof and two-person enablement';
  v_system_marker constant jsonb := jsonb_build_object(
    'route_id', 'b4c80000-0000-4000-8000-000000000001'::uuid,
    'route_key', 'ng-ngn-ngn-bachs',
    'version', 1,
    'status', 'DISABLED',
    'money_enabled', false
  );
begin
  -- A pre-existing SANDBOX_ONLY Dev route is not owned by this migration.
  if not exists (
    select 1 from public.audit_logs
    where actor_id = 'phase4-production-migration'
      and actor_role = 'SYSTEM'
      and event = 'payments.phase4_bachs_ngn_route_seeded'
      and severity = 'notice'
      and payload = v_system_marker
  ) then
    return;
  end if;

  if not exists (
    select 1 from public.payment_routes where id = v_route_id
  ) then
    raise exception 'System seed audit marker exists but the route is missing';
  end if;

  if exists (
    select 1 from public.payment_routes
    where id = v_route_id
      and (status <> 'DISABLED' or active_enablement_request_id is not null)
  ) then
    raise exception 'Refusing to remove a Bachs route that is no longer disabled';
  end if;

  if exists (select 1 from public.orders where payment_route_id = v_route_id)
    or exists (select 1 from public.payment_route_enablement_requests where route_id = v_route_id)
    or exists (select 1 from public.payment_route_approvals where route_id = v_route_id) then
    raise exception 'Refusing to remove a Bachs route with dependent evidence';
  end if;

  if (select count(*) from public.payment_route_audit_events where route_id = v_route_id) <> 1
    or not exists (
      select 1 from public.payment_route_audit_events
      where route_id = v_route_id
        and actor_id is null
        and actor_workforce_principal_id is null
        and action = 'CREATED'
        and previous_status is null
        and new_status = 'DISABLED'
        and reason = v_seed_reason
        and evidence = '{}'::jsonb
    ) then
    raise exception 'Refusing to remove a Bachs route with non-seed audit history';
  end if;

  delete from public.payment_route_audit_events
  where route_id = v_route_id and action = 'CREATED' and reason = v_seed_reason;

  delete from public.audit_logs
  where actor_id = 'phase4-production-migration'
    and actor_role = 'SYSTEM'
    and event = 'payments.phase4_bachs_ngn_route_seeded'
    and severity = 'notice'
    and payload = v_system_marker;

  alter table public.payment_routes disable trigger payment_routes_audit_guard;
  delete from public.payment_routes
  where id = v_route_id
    and route_key = 'ng-ngn-ngn-bachs'
    and version = 1
    and status = 'DISABLED';
  alter table public.payment_routes enable trigger payment_routes_audit_guard;
end
$rollback$;
