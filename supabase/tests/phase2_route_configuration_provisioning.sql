-- Rollback-only proof for the Phase 2 Ops configuration creation controls.
begin;

insert into public.ops_workforce_principals (
  id, email, status, roles, permitted_environments, access_review_due_at, created_by
) values (
  'b526e0dd-347a-4ec8-824c-5f4d80a33f7b',
  'phase2-route-provision-test@example.invalid',
  'ACTIVE', array['admin']::text[], array['development']::text[], now() + interval '1 day', 'rollback-test'
);

set local role service_role;

do $test$
declare
  v_route_id uuid;
  v_route_retry_id uuid;
  v_delivery_id uuid;
  v_audit_count integer;
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'payout_destinations'
        and column_name = 'tailor_profile_id') is distinct from
     (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'tailor_profiles'
        and column_name = 'id') then
    raise exception 'Payout destination profile key does not match tailor_profiles.id';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payout_destinations_tailor_profile_id_fkey') then
    raise exception 'Payout destination is missing its profile foreign key';
  end if;

  v_route_id := public.ops_create_phase2_payment_route(
    'b526e0dd-347a-4ec8-824c-5f4d80a33f7b', 'ng-ngn-ngn-bachs', 1,
    'NG', 'NGN', 'NGN', 'BACHS', 'DRAPE_MARKETPLACE_LIMITED',
    'customer-disclosed-provider-costs-v1', 'Create the Bachs sandbox route fixture'
  );
  v_route_retry_id := public.ops_create_phase2_payment_route(
    'b526e0dd-347a-4ec8-824c-5f4d80a33f7b', 'ng-ngn-ngn-bachs', 1,
    'NG', 'NGN', 'NGN', 'BACHS', 'DRAPE_MARKETPLACE_LIMITED',
    'customer-disclosed-provider-costs-v1', 'Retry the same route fixture'
  );
  if v_route_id <> v_route_retry_id then raise exception 'Route create retry produced a different ID'; end if;
  if (select status from public.payment_routes where id = v_route_id) <> 'DISABLED' then
    raise exception 'New payment route did not start disabled';
  end if;
  if (select created_by from public.payment_routes where id = v_route_id) is not null then
    raise exception 'Workforce principal was incorrectly written into the auth.users created_by column';
  end if;
  select count(*) into v_audit_count from public.payment_route_audit_events
    where route_id = v_route_id and action = 'CREATED'
      and actor_workforce_principal_id = 'b526e0dd-347a-4ec8-824c-5f4d80a33f7b';
  if v_audit_count <> 1 then raise exception 'Route creation audit was not attributed exactly once'; end if;

  begin
    perform public.ops_create_phase2_payment_route(
      'b526e0dd-347a-4ec8-824c-5f4d80a33f7b', 'ng-ngn-ngn-bachs', 1,
      'NG', 'USD', 'NGN', 'BACHS', 'DRAPE_MARKETPLACE_LIMITED',
      'customer-disclosed-provider-costs-v1', 'Reject a mismatched corridor template'
    );
    raise exception 'Mismatched route template was accepted';
  exception when sqlstate '22023' then null;
  end;

  perform public.ops_mark_payment_route_sandbox_only(
    v_route_id, 'b526e0dd-347a-4ec8-824c-5f4d80a33f7b', 'Sandbox evidence will be verified separately'
  );
  perform public.ops_mark_payment_route_sandbox_only(
    v_route_id, 'b526e0dd-347a-4ec8-824c-5f4d80a33f7b', 'Idempotent sandbox-only retry'
  );
  if (select status from public.payment_routes where id = v_route_id) <> 'SANDBOX_ONLY' then
    raise exception 'Audited sandbox-only transition failed';
  end if;
  if exists (select 1 from public.payment_routes where id = v_route_id and status = 'ENABLED') then
    raise exception 'Provisioning path enabled checkout';
  end if;

  v_delivery_id := public.ops_create_phase2_delivery_country_rule(
    'b526e0dd-347a-4ec8-824c-5f4d80a33f7b', 'US', 1,
    false, false, false, true, false, '', 'Add the approved US duty disclosure rule'
  );
  if (select status from public.delivery_country_rules where id = v_delivery_id) <> 'DISABLED'
    or not (select duties_customer_pays from public.delivery_country_rules where id = v_delivery_id) then
    raise exception 'US delivery rule was not created disabled with customer-pays-duty';
  end if;
  if not exists (
    select 1 from public.delivery_country_audit_events event
    where event.delivery_country_rule_id = v_delivery_id
      and event.actor_workforce_principal_id = 'b526e0dd-347a-4ec8-824c-5f4d80a33f7b'
      and event.new_status = 'DISABLED'
  ) then raise exception 'Delivery-country creation audit is missing workforce actor'; end if;

  begin
    perform public.ops_create_phase2_delivery_country_rule(
      'b526e0dd-347a-4ec8-824c-5f4d80a33f7b', 'GB', 1,
      false, true, true, false, false, '', 'Attempt to mark UK compliance without evidence'
    );
    raise exception 'UK readiness flags were accepted without an evidence reference';
  exception when sqlstate '22023' then null;
  end;
end
$test$;

rollback;
