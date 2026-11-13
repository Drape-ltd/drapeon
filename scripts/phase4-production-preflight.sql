-- Read-only Phase 4 Production preflight. This script must run before P4-1.
-- It returns configuration/catalog evidence only; it does not read customer data.

begin transaction read only;

with expected(version) as (
  values
    ('20261030154721'),
    ('20261030231747'),
    ('20261102054500')
)
select
  expected.version,
  (migration.version is not null) as already_applied
from expected
left join supabase_migrations.schema_migrations migration
  on migration.version = expected.version
order by expected.version;

with expected(version) as (
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
)
select
  expected.version,
  (migration.version is not null) as already_applied
from expected
left join supabase_migrations.schema_migrations migration
  on migration.version = expected.version
order by expected.version;

select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payout_destinations'
      and column_name = 'provider_requirements_currently_due_count'
  ) as provider_requirements_currently_due_count_exists,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payout_destinations'
      and column_name = 'provider_requirements_past_due_count'
  ) as provider_requirements_past_due_count_exists,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payout_destinations'
      and column_name = 'provider_disabled_reason'
  ) as provider_disabled_reason_exists,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payout_destinations'
      and column_name = 'provider_external_account_present'
  ) as provider_external_account_present_exists,
  to_regprocedure(
    'public.sync_stripe_payout_profile_readiness(text,text,boolean,text,timestamptz)'
  ) is not null as stripe_payout_readiness_rpc_exists,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payout_destinations'
      and column_name = 'provider_destination_ref'
  ) as provider_destination_ref_exists,
  to_regprocedure('public.claim_bachs_checkout_request(uuid,text)') is not null
    as checkout_claim_rpc_exists,
  to_regprocedure(
    'public.reject_bachs_checkout_request(uuid,text,integer,text,text[])'
  ) is not null as checkout_rejection_rpc_exists,
  to_regprocedure(
    'public.reserve_settlement_tranche_payout_row(uuid,text,uuid,text,text,text,text)'
  ) is not null as tranche_reservation_rpc_exists;

select
  count(*) filter (where destination.provider = 'BACHS') as bachs_destinations,
  count(*) filter (
    where to_jsonb(destination)->>'provider_destination_ref' is not null
  )
    as provider_destination_references
from public.payout_destinations destination;

select
  conname as constraint_name,
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
  and (
    (p.proname = 'claim_bachs_checkout_request'
      and pg_get_function_identity_arguments(p.oid) = 'p_payment_id uuid, p_idempotency_key text')
    or (p.proname = 'reject_bachs_checkout_request'
      and pg_get_function_identity_arguments(p.oid) =
        'p_payment_id uuid, p_idempotency_key text, p_http_status integer, p_provider_code text, p_validation_fields text[]')
    or (p.proname = 'reserve_settlement_tranche_payout_row'
      and pg_get_function_identity_arguments(p.oid) =
        'p_order_id uuid, p_tranche_id text, p_actor_id uuid, p_provider text, p_provider_account_ref text, p_currency text, p_provider_idempotency_key text')
  )
order by p.proname;

select
  count(*) filter (where provider = 'BACHS' and status = 'ENABLED')
    as enabled_bachs_routes,
  count(*) filter (where provider = 'BACHS') as all_bachs_routes,
  count(*) filter (
    where route_key = 'ng-ngn-ngn-bachs' and version = 1
  ) as target_route_rows,
  count(*) filter (
    where route_key = 'ng-ngn-ngn-bachs'
      and active_enablement_request_id is not null
  ) as target_active_enablement_requests
from public.payment_routes;

select count(*) as target_route_snapshots
from public.orders
where payment_route_id = 'b4c80000-0000-4000-8000-000000000001'::uuid;

select count(*) as active_bachs_destinations
from public.payout_destinations
where provider = 'BACHS' and active;

rollback;
