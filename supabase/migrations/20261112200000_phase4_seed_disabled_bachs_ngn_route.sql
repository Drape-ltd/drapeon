-- Phase 4 live-readiness seed. This creates configuration only: the route is
-- DISABLED, has no destination, and cannot accept or move money.

do $migration$
declare
  v_route_id constant uuid := 'b4c80000-0000-4000-8000-000000000001'::uuid;
  v_existing public.payment_routes%rowtype;
begin
  select *
  into v_existing
  from public.payment_routes
  where route_key = 'ng-ngn-ngn-bachs'
    and version = 1;

  if found then
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
      raise exception using
        errcode = '23505',
        message = 'Existing Bachs NGN route version conflicts with the reviewed disabled seed';
    end if;
    return;
  end if;

  if exists (
    select 1
    from public.payment_routes
    where id = v_route_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'Reserved Phase 4 Bachs NGN route ID is already in use';
  end if;

  perform set_config(
    'app.payment_route_actor_principal_id',
    '00000000-0000-4000-8000-000000000004',
    true
  );
  perform set_config(
    'app.payment_route_change_reason',
    'Phase 4 reviewed Production seed; route remains disabled pending live proof and two-person enablement',
    true
  );

  insert into public.payment_routes (
    id,
    route_key,
    version,
    tailor_country_code,
    charge_currency,
    payout_currency,
    provider,
    legal_entity,
    status,
    active_enablement_request_id,
    fees_collector,
    fee_schedule_version,
    confirmed_card_issuer_countries
  ) values (
    v_route_id,
    'ng-ngn-ngn-bachs',
    1,
    'NG',
    'NGN',
    'NGN',
    'BACHS',
    'DRAPE_MARKETPLACE_LIMITED',
    'DISABLED',
    null,
    'PLATFORM',
    'ngn-card-provider-cost-2pct-v1',
    '{}'::text[]
  );

  insert into public.audit_logs (
    actor_id,
    actor_role,
    event,
    severity,
    payload
  ) values (
    'phase4-production-migration',
    'SYSTEM',
    'payments.phase4_bachs_ngn_route_seeded',
    'notice',
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

