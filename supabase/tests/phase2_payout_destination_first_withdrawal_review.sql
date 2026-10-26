-- Non-mutating catalog/security contract for first-withdrawal review controls.
begin;

insert into public.ops_workforce_principals (
  id, email, status, roles, permitted_environments, access_review_due_at, created_by
) values (
  'd59d481e-ec8d-441f-ad29-8bf6f461159e',
  'phase2-destination-review@example.invalid',
  'ACTIVE', array['admin']::text[], array['development']::text[], now() + interval '1 day', 'rollback-test'
);

set local role service_role;

do $test$
declare
  v_rpc regprocedure := to_regprocedure('public.ops_review_payout_destination_first_withdrawal(uuid,uuid,text,text,text)');
  v_guard regprocedure := to_regprocedure('private.guard_payout_destination_identity()');
  v_guard_sql text;
  v_profile_id public.payout_destinations.tailor_profile_id%type;
  v_result jsonb;
  v_review_count integer;
begin
  if to_regclass('public.payout_destination_review_events') is null then
    raise exception 'Payout destination review audit table is missing';
  end if;
  if not exists (
    select 1 from pg_class
    where oid = 'public.payout_destination_review_events'::regclass and relrowsecurity
  ) then
    raise exception 'Payout destination review audit table must have RLS enabled';
  end if;
  if has_table_privilege('anon', 'public.payout_destination_review_events', 'SELECT')
    or has_table_privilege('authenticated', 'public.payout_destination_review_events', 'SELECT') then
    raise exception 'Public API roles must not read the Ops-only review audit table';
  end if;
  if not has_table_privilege('service_role', 'public.payout_destination_review_events', 'SELECT') then
    raise exception 'Ops server service role is missing review-audit read access';
  end if;
  if v_rpc is null or has_function_privilege('anon', v_rpc, 'EXECUTE')
    or has_function_privilege('authenticated', v_rpc, 'EXECUTE')
    or not has_function_privilege('service_role', v_rpc, 'EXECUTE') then
    raise exception 'First-withdrawal review RPC grants are not service-role-only';
  end if;
  if v_guard is null then raise exception 'Payout destination guard is missing'; end if;
  select pg_get_functiondef(v_guard::oid) into v_guard_sql;
  if position('payout_destination_review_events' in v_guard_sql) = 0
    or position('app.payout_destination_review_actor_id' in v_guard_sql) > 0 then
    raise exception 'Destination trigger guard must use an audit row, not a caller-controlled setting';
  end if;
  if position('provider_bank_payout_id' in pg_get_functiondef(v_rpc::oid)) = 0
    or position('interval ''15 minutes''' in pg_get_functiondef(v_rpc::oid)) = 0 then
    raise exception 'Review RPC must require a matching provider withdrawal and recent capability check';
  end if;

  select id into v_profile_id from public.tailor_profiles where coalesce(is_test_profile, false) limit 1;
  if v_profile_id is null then raise exception 'A test tailor profile is required for the rollback-only behavior proof'; end if;

  insert into public.payout_destinations (
    id, tailor_profile_id, provider, legal_entity, country_code, currency, provider_account_ref,
    transfers_enabled, payouts_enabled, fees_collector, first_withdrawal_review_status,
    active, capability_checked_at
  ) values (
    '1a2e300d-29f8-4c29-a217-847f10bdaf01', v_profile_id, 'STRIPE', 'O4_GROUP_LLC', 'US', 'USD',
    'acct_phase2_review_test', true, true, 'PLATFORM', 'PENDING', false, now()
  );
  insert into public.provider_payout_events (
    provider, provider_event_id, event_type, provider_destination_id,
    provider_bank_payout_id, amount, currency, status, processed_at
  ) values (
    'STRIPE', 'evt_phase2_review_test', 'payout.paid', 'acct_phase2_review_test',
    'po_phase2_review_test', 1000, 'USD', 'PAID', now()
  );

  -- A caller-controlled custom GUC must not bypass the audited review RPC.
  perform set_config('app.payout_destination_review_actor_id', 'd59d481e-ec8d-441f-ad29-8bf6f461159e', true);
  begin
    update public.payout_destinations
    set first_withdrawal_review_status = 'CLEARED', active = true
    where id = '1a2e300d-29f8-4c29-a217-847f10bdaf01';
    raise exception 'A forged transaction-local setting bypassed the audit RPC';
  exception when sqlstate '23514' then null;
  end;
  if (select first_withdrawal_review_status from public.payout_destinations where id = '1a2e300d-29f8-4c29-a217-847f10bdaf01') <> 'PENDING' then
    raise exception 'Rejected direct update changed destination status';
  end if;
  if has_table_privilege('service_role', 'public.payout_destination_review_events', 'INSERT') then
    raise exception 'service_role must not insert review authorization events directly';
  end if;

  v_result := public.ops_review_payout_destination_first_withdrawal(
    '1a2e300d-29f8-4c29-a217-847f10bdaf01', 'd59d481e-ec8d-441f-ad29-8bf6f461159e',
    'CLEARED', 'po_phase2_review_test', 'Rollback-only successful withdrawal review proof'
  );
  if v_result ->> 'active' <> 'true'
    or (select first_withdrawal_review_status from public.payout_destinations where id = '1a2e300d-29f8-4c29-a217-847f10bdaf01') <> 'CLEARED' then
    raise exception 'A matching recent successful withdrawal did not clear the destination';
  end if;
  perform public.ops_review_payout_destination_first_withdrawal(
    '1a2e300d-29f8-4c29-a217-847f10bdaf01', 'd59d481e-ec8d-441f-ad29-8bf6f461159e',
    'CLEARED', 'po_phase2_review_test', 'Idempotent first-withdrawal review retry'
  );
  select count(*) into v_review_count from public.payout_destination_review_events
  where payout_destination_id = '1a2e300d-29f8-4c29-a217-847f10bdaf01';
  if v_review_count <> 1 then raise exception 'Duplicate review submission created more than one audit event'; end if;

  insert into public.payout_destinations (
    id, tailor_profile_id, provider, legal_entity, country_code, currency, provider_account_ref,
    transfers_enabled, payouts_enabled, fees_collector, first_withdrawal_review_status,
    active, capability_checked_at
  ) values (
    '1a2e300d-29f8-4c29-a217-847f10bdaf02', v_profile_id, 'STRIPE', 'O4_GROUP_LLC', 'US', 'USD',
    'acct_phase2_review_missing_evidence', true, true, 'PLATFORM', 'PENDING', false, now()
  );
  begin
    perform public.ops_review_payout_destination_first_withdrawal(
      '1a2e300d-29f8-4c29-a217-847f10bdaf02', 'd59d481e-ec8d-441f-ad29-8bf6f461159e',
      'CLEARED', 'po_missing_event', 'This review must fail without a matching paid event'
    );
    raise exception 'A destination without a matching provider payout event was cleared';
  exception when sqlstate '23514' then null;
  end;
  if (select first_withdrawal_review_status from public.payout_destinations where id = '1a2e300d-29f8-4c29-a217-847f10bdaf02') <> 'PENDING'
    or exists (select 1 from public.payout_destination_review_events where payout_destination_id = '1a2e300d-29f8-4c29-a217-847f10bdaf02') then
    raise exception 'A rejected review changed destination state or wrote an audit event';
  end if;
end
$test$;

rollback;
