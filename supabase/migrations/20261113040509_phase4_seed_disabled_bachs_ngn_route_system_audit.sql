-- The route audit guard normally requires an authenticated user or named Ops
-- principal. A schema migration is neither. Permit one exact, disabled Bachs
-- route seed when the migration sets its transaction-local system-seed marker;
-- the companion audit_logs row records the system identity and reason.

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
  v_system_seed boolean := false;
  v_approver_count integer;
  v_evidence_complete boolean;
begin
  v_actor_id := auth.uid();
  v_workforce_actor_id := nullif(current_setting('app.payment_route_actor_principal_id', true), '')::uuid;
  v_reason := nullif(trim(current_setting('app.payment_route_change_reason', true)), '');

  if tg_op = 'INSERT' then
    v_system_seed := v_actor_id is null
      and v_workforce_actor_id is null
      and new.created_by is null
      and current_setting('app.payment_route_system_seed_id', true) = 'b4c80000-0000-4000-8000-000000000001'
      and new.id = 'b4c80000-0000-4000-8000-000000000001'::uuid
      and new.route_key = 'ng-ngn-ngn-bachs'
      and new.version = 1
      and new.tailor_country_code = 'NG'
      and new.charge_currency = 'NGN'
      and new.payout_currency = 'NGN'
      and new.provider = 'BACHS'
      and new.legal_entity = 'DRAPE_MARKETPLACE_LIMITED'
      and new.status = 'DISABLED'
      and new.active_enablement_request_id is null
      and new.fees_collector = 'PLATFORM'
      and new.fee_schedule_version = 'ngn-card-provider-cost-2pct-v1'
      and new.confirmed_card_issuer_countries = '{}'::text[]
      and v_reason = 'Phase 4 reviewed Production seed; route remains disabled pending live proof and two-person enablement';

    if new.status <> 'DISABLED' or new.active_enablement_request_id is not null then
      raise exception using errcode = '23514', constraint = 'payment_routes_created_disabled', message = 'Payment routes must be created disabled';
    end if;
    if ((v_actor_id is null and v_workforce_actor_id is null) and not v_system_seed)
      or v_reason is null then
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

do $migration$
declare
  v_route_id constant uuid := 'b4c80000-0000-4000-8000-000000000001'::uuid;
  v_seed_reason constant text :=
    'Phase 4 reviewed Production seed; route remains disabled pending live proof and two-person enablement';
  v_existing public.payment_routes%rowtype;
begin
  select * into v_existing
  from public.payment_routes
  where route_key = 'ng-ngn-ngn-bachs' and version = 1;

  if found then
    -- Dev already has a SANDBOX_ONLY version of this corridor, with a
    -- different route ID and fee schedule. Preserve that project-local route;
    -- Production preflight separately requires that no Bachs route exists.
    if v_existing.tailor_country_code = 'NG'
      and v_existing.charge_currency = 'NGN'
      and v_existing.payout_currency = 'NGN'
      and v_existing.provider = 'BACHS'
      and v_existing.legal_entity = 'DRAPE_MARKETPLACE_LIMITED'
      and v_existing.status = 'SANDBOX_ONLY'
      and v_existing.active_enablement_request_id is null
      and v_existing.fees_collector = 'PLATFORM'
      and v_existing.confirmed_card_issuer_countries = '{}'::text[] then
      return;
    end if;

    if v_existing.id is distinct from v_route_id
      or v_existing.tailor_country_code <> 'NG'
      or v_existing.charge_currency <> 'NGN'
      or v_existing.payout_currency <> 'NGN'
      or v_existing.provider <> 'BACHS'
      or v_existing.legal_entity <> 'DRAPE_MARKETPLACE_LIMITED'
      or v_existing.status <> 'DISABLED'
      or v_existing.active_enablement_request_id is not null
      or v_existing.fees_collector <> 'PLATFORM'
      or v_existing.fee_schedule_version <> 'ngn-card-provider-cost-2pct-v1'
      or v_existing.confirmed_card_issuer_countries <> '{}'::text[] then
      raise exception using errcode = '23505', message = 'Existing Bachs NGN route version conflicts with the reviewed disabled seed';
    end if;
    return;
  end if;

  if exists (select 1 from public.payment_routes where id = v_route_id) then
    raise exception using errcode = '23505', message = 'Reserved Phase 4 Bachs NGN route ID is already in use';
  end if;

  perform set_config('app.payment_route_actor_principal_id', '', true);
  perform set_config('app.payment_route_actor_id', '', true);
  perform set_config('app.payment_route_system_seed_id', v_route_id::text, true);
  perform set_config('app.payment_route_change_reason', v_seed_reason, true);

  insert into public.payment_routes (
    id, route_key, version, tailor_country_code, charge_currency,
    payout_currency, provider, legal_entity, status,
    active_enablement_request_id, fees_collector, fee_schedule_version,
    confirmed_card_issuer_countries
  ) values (
    v_route_id, 'ng-ngn-ngn-bachs', 1, 'NG', 'NGN', 'NGN', 'BACHS',
    'DRAPE_MARKETPLACE_LIMITED', 'DISABLED', null, 'PLATFORM',
    'ngn-card-provider-cost-2pct-v1', '{}'::text[]
  );

  insert into public.audit_logs (
    actor_id, actor_role, event, severity, payload
  ) values (
    'phase4-production-migration', 'SYSTEM',
    'payments.phase4_bachs_ngn_route_seeded', 'notice',
    jsonb_build_object(
      'route_id', v_route_id,
      'route_key', 'ng-ngn-ngn-bachs',
      'version', 1,
      'status', 'DISABLED',
      'money_enabled', false
    )
  );
end
$migration$;
