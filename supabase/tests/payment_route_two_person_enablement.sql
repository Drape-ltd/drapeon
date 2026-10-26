-- Rollback-only integration smoke for workforce-principal route approvals.
-- Run only against a disposable local Supabase stack with the Phase 2 foundation.
begin;
set local role service_role;
do $privileges$
begin
  if has_table_privilege('service_role', 'public.payment_route_approvals', 'INSERT') then
    raise exception 'service_role can bypass the audited route approval RPC';
  end if;
  if has_function_privilege('anon', 'public.ops_submit_payment_route_enablement_approval(uuid,uuid,uuid,text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.ops_submit_payment_route_enablement_approval(uuid,uuid,uuid,text,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.ops_submit_payment_route_enablement_approval(uuid,uuid,uuid,text,jsonb)', 'EXECUTE') then
    raise exception 'Route approval RPC grants are not service-role-only';
  end if;
end
$privileges$;
select set_config('app.payment_route_actor_id', '00000000-0000-4000-8000-000000000001', true);
select set_config('app.payment_route_actor_principal_id', 'aebd7ede-6620-48f5-b1e5-f96b49392dfe', true);
select set_config('app.payment_route_change_reason', 'Local two-person enablement test fixture', true);

insert into public.payment_routes (
  id, route_key, version, tailor_country_code, charge_currency, payout_currency,
  provider, legal_entity, status, fees_collector, fee_schedule_version,
  confirmed_card_issuer_countries, created_by
) values (
  'a6e9dd14-b972-4ca1-a87d-677ef10c931e', 'local-bachs-ngn-ngn-enable-test', 1,
  'NG', 'NGN', 'NGN', 'BACHS', 'DRAPE_MARKETPLACE_LIMITED', 'DISABLED',
  'PLATFORM', 'local-test-v1', array['NG']::text[],
  '00000000-0000-4000-8000-000000000001'
);
update public.payment_routes set status = 'SANDBOX_ONLY'
where id = 'a6e9dd14-b972-4ca1-a87d-677ef10c931e';

do $test$
declare
  v_first jsonb;
  v_duplicate jsonb;
  v_second jsonb;
  v_second_duplicate jsonb;
  v_request_id uuid;
  v_approval_count integer;
  v_distinct_approvers integer;
  v_audit_count integer;
begin
  begin
    perform public.ops_submit_payment_route_enablement_approval(
      'a6e9dd14-b972-4ca1-a87d-677ef10c931e',
      'aebd7ede-6620-48f5-b1e5-f96b49392dfe', null,
      'First local evidence review',
      '{"collection":"collect-test-1","settlement":"settle-test-1","transfer":"transfer-test-1","tailor_withdrawal":"withdraw-test-1"}'::jsonb
    );
    raise exception 'Bachs confirmation was not required';
  exception when others then
    if sqlerrm = 'Bachs confirmation was not required' then raise; end if;
  end;

  v_first := public.ops_submit_payment_route_enablement_approval(
    'a6e9dd14-b972-4ca1-a87d-677ef10c931e',
    'aebd7ede-6620-48f5-b1e5-f96b49392dfe', null,
    'First local evidence review',
    '{"collection":"collect-test-1","settlement":"settle-test-1","transfer":"transfer-test-1","tailor_withdrawal":"withdraw-test-1","provider_confirmation":"bachs-email-test-1"}'::jsonb
  );
  v_request_id := (v_first ->> 'request_id')::uuid;
  if v_first ->> 'route_enabled' <> 'false' then raise exception 'First approval enabled route'; end if;
  if (select status from public.payment_routes where id = 'a6e9dd14-b972-4ca1-a87d-677ef10c931e') <> 'SANDBOX_ONLY' then
    raise exception 'Route left sandbox after only one approval';
  end if;

  v_duplicate := public.ops_submit_payment_route_enablement_approval(
    'a6e9dd14-b972-4ca1-a87d-677ef10c931e',
    'aebd7ede-6620-48f5-b1e5-f96b49392dfe', v_request_id,
    'Repeated local evidence review',
    '{"collection":"collect-test-1","settlement":"settle-test-1","transfer":"transfer-test-1","tailor_withdrawal":"withdraw-test-1","provider_confirmation":"bachs-email-test-1"}'::jsonb
  );
  if v_duplicate ->> 'duplicate' <> 'true' then raise exception 'Same approver retry was not idempotent'; end if;

  begin
    update public.payment_routes set status = 'ENABLED', active_enablement_request_id = v_request_id
    where id = 'a6e9dd14-b972-4ca1-a87d-677ef10c931e';
    raise exception 'Direct one-approver enablement bypassed guard';
  exception when check_violation then null;
  end;

  begin
    perform public.ops_submit_payment_route_enablement_approval(
      'a6e9dd14-b972-4ca1-a87d-677ef10c931e',
      '891a767c-e10f-4ebc-9ba5-0e242c7dcaea', v_request_id,
      'Second local evidence review',
      '{"collection":"collect-test-2","settlement":"settle-test-2","transfer":"transfer-test-2","tailor_withdrawal":"withdraw-test-2"}'::jsonb
    );
    raise exception 'Second Bachs confirmation was not required';
  exception when others then
    if sqlerrm = 'Second Bachs confirmation was not required' then raise; end if;
  end;

  v_second := public.ops_submit_payment_route_enablement_approval(
    'a6e9dd14-b972-4ca1-a87d-677ef10c931e',
    '891a767c-e10f-4ebc-9ba5-0e242c7dcaea', v_request_id,
    'Second local evidence review',
    '{"collection":"collect-test-2","settlement":"settle-test-2","transfer":"transfer-test-2","tailor_withdrawal":"withdraw-test-2","provider_confirmation":"bachs-email-test-2"}'::jsonb
  );
  if v_second ->> 'route_enabled' <> 'true' then raise exception 'Second valid approval did not enable sandbox fixture'; end if;
  v_second_duplicate := public.ops_submit_payment_route_enablement_approval(
    'a6e9dd14-b972-4ca1-a87d-677ef10c931e',
    '891a767c-e10f-4ebc-9ba5-0e242c7dcaea', v_request_id,
    'Second local evidence review',
    '{"collection":"collect-test-2","settlement":"settle-test-2","transfer":"transfer-test-2","tailor_withdrawal":"withdraw-test-2","provider_confirmation":"bachs-email-test-2"}'::jsonb
  );
  if v_second_duplicate ->> 'route_enabled' <> 'true' or v_second_duplicate ->> 'duplicate' <> 'true' then
    raise exception 'Repeated successful second approval was not safely idempotent';
  end if;
  if (select status from public.payment_routes where id = 'a6e9dd14-b972-4ca1-a87d-677ef10c931e') <> 'ENABLED' then
    raise exception 'Route status did not update after the second approval';
  end if;
  if (select status from public.payment_route_enablement_requests where id = v_request_id) <> 'ENABLED' then
    raise exception 'Enablement request did not finish';
  end if;
  select count(*), count(distinct approver_workforce_principal_id)
  into v_approval_count, v_distinct_approvers
  from public.payment_route_approvals where enablement_request_id = v_request_id;
  if v_approval_count <> 2 or v_distinct_approvers <> 2 then raise exception 'Approval identity count was not exactly two distinct principals'; end if;
  select count(*) into v_audit_count from public.audit_logs
    where event = 'ops.payment_route_enablement_approval_submitted'
      and payload ->> 'request_id' = v_request_id::text;
  if v_audit_count <> 2 then raise exception 'Expected two central audit events for approvals'; end if;
  if not exists (
    select 1 from public.payment_route_audit_events event
    where event.route_id = 'a6e9dd14-b972-4ca1-a87d-677ef10c931e'
      and event.new_status = 'ENABLED'
      and jsonb_array_length(event.evidence -> 'approvals') = 2
      and event.evidence -> 'approvals' @> '[{"approver_workforce_principal_id":"aebd7ede-6620-48f5-b1e5-f96b49392dfe","evidence":{"provider_confirmation":"bachs-email-test-1"}}]'::jsonb
  ) then raise exception 'Route status audit did not preserve approval evidence and workforce actor IDs'; end if;

  insert into public.payment_routes (
    id, route_key, version, tailor_country_code, charge_currency, payout_currency,
    provider, legal_entity, status, fees_collector, fee_schedule_version,
    confirmed_card_issuer_countries, created_by
  ) values (
    'b7b14bf5-54a5-4b29-9a57-317fb00f503e', 'local-stripe-open-request-cancel-test', 1,
    'US', 'USD', 'USD', 'STRIPE', 'O4_GROUP_LLC', 'DISABLED', 'PLATFORM', 'local-test-v1',
    array['US']::text[], '00000000-0000-4000-8000-000000000001'
  );
  update public.payment_routes set status = 'SANDBOX_ONLY'
    where id = 'b7b14bf5-54a5-4b29-9a57-317fb00f503e';
  v_first := public.ops_submit_payment_route_enablement_approval(
    'b7b14bf5-54a5-4b29-9a57-317fb00f503e',
    'aebd7ede-6620-48f5-b1e5-f96b49392dfe', null,
    'Open local route review before disable',
    '{"collection":"stripe-collect-local","settlement":"stripe-settle-local","transfer":"stripe-transfer-local","tailor_withdrawal":"stripe-withdraw-local"}'::jsonb
  );
  v_request_id := (v_first ->> 'request_id')::uuid;
  perform public.ops_disable_payment_route(
    'b7b14bf5-54a5-4b29-9a57-317fb00f503e',
    'aebd7ede-6620-48f5-b1e5-f96b49392dfe',
    'Disable local route to test approval cancellation'
  );
  if (select status from public.payment_route_enablement_requests where id = v_request_id) <> 'CANCELLED' then
    raise exception 'Disabling a route did not cancel its open approval request';
  end if;
end
$test$;

rollback;
