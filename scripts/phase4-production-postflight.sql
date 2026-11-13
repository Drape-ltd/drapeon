-- Read-only Phase 4 Production postflight. This verifies the disabled
-- foundation only; it does not authorize provider calls or route enablement.

select
  expected.version,
  migration.version is not null as applied
from (
  values
    ('20261112181838'),
    ('20261112185135'),
    ('20261112185545'),
    ('20261112185931'),
    ('20261112193225'),
    ('20261112200000'),
    ('20261112201000'),
    ('20261112203000'),
    ('20261112204000')
) as expected(version)
left join supabase_migrations.schema_migrations migration
  on migration.version = expected.version
order by expected.version;

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payout_destinations'
  and column_name = 'provider_destination_ref';

select
  conname as constraint_name,
  convalidated as validated,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
    'public.order_payments'::regclass,
    'public.payout_destinations'::regclass
  )
  and conname in (
    'order_payments_bachs_request_state_shape',
    'payout_destinations_provider_destination_ref_format',
    'payout_destinations_bachs_active_provider_destination'
  )
order by conname;

select
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'payout_destinations'
  and trigger_name = 'payout_destination_provider_reference_immutable';

select
  p.oid::regprocedure::text as function_signature,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')
    as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE')
    as service_role_execute,
  md5(pg_get_functiondef(p.oid)) as definition_md5
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'claim_bachs_checkout_request',
    'reject_bachs_checkout_request',
    'reserve_settlement_tranche_payout_row',
    'accept_active_order_quote_with_route_snapshot_v2',
    'snapshot_ready_made_payment_route_v2'
  )
order by p.proname, p.oid::regprocedure::text;

select
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
from public.payment_routes
where route_key = 'ng-ngn-ngn-bachs'
order by version;

select
  count(*) filter (where status = 'ENABLED') as enabled_routes,
  count(*) filter (where provider = 'BACHS' and status = 'ENABLED')
    as enabled_bachs_routes,
  count(*) filter (
    where route_key = 'ng-ngn-ngn-bachs'
      and active_enablement_request_id is not null
  ) as active_bachs_enablement_requests
from public.payment_routes;

select
  count(*) as accepted_orders_on_phase4_route
from public.orders
where payment_route_id = 'b4c80000-0000-4000-8000-000000000001'::uuid;
