do $rehearsal$
declare
  phase text := current_setting('drape.pay003_c2_phase');
  payout_guard regprocedure := to_regprocedure('public.guard_payout_forward_status()');
  transfer_rpc regprocedure := to_regprocedure('public.apply_stripe_transfer_event_to_payout(text,text,text,text,integer,text,jsonb)');
  readiness_rpc regprocedure := to_regprocedure('public.sync_stripe_payout_profile_readiness(text,text,boolean,text,timestamptz)');
begin
  if phase in ('baseline', 'rollback_2a') then
    if payout_guard is not null or transfer_rpc is not null
       or exists (select 1 from pg_trigger where tgrelid='public.payouts'::regclass and tgname='payout_forward_status_guard') then
      raise exception '2a objects or trigger leaked from rollback';
    end if;
    if (select status::text from public.payouts where id='83000000-0000-4000-8000-000000000001') <> 'FAILED'
       or (select provider_destination_id from public.payouts where id='83000000-0000-4000-8000-000000000001') is not null then
      raise exception 'baseline payout fixture changed';
    end if;
    if readiness_rpc is not null then raise exception 'readiness migration leaked into baseline'; end if;
    if not exists (select 1 from pg_trigger where tgrelid='public.tailor_profiles'::regclass and tgname='tailor_profile_readiness_write_guard') then
      raise exception 'predecessor tailor profile guard is absent';
    end if;
  elsif phase = 'green_2a' then
    if payout_guard is null or transfer_rpc is null
       or not exists (select 1 from pg_trigger where tgrelid='public.payouts'::regclass and tgname='payout_forward_status_guard' and tgenabled <> 'D') then
      raise exception '2a guard function, transfer RPC, or enabled trigger is absent';
    end if;
    if not has_function_privilege('service_role', transfer_rpc, 'EXECUTE')
       or has_function_privilege('anon', transfer_rpc, 'EXECUTE')
       or has_function_privilege('authenticated', transfer_rpc, 'EXECUTE') then
      raise exception '2a transfer RPC grants are not service-role-only';
    end if;
    begin
      update public.payouts set status='PROCESSING'
      where id='83000000-0000-4000-8000-000000000001';
      raise exception '2a allowed FAILED -> PROCESSING without a reviewed recovery';
    exception when others then
      if sqlerrm not like 'ILLEGAL_PAYOUT_STATUS_TRANSITION:FAILED->PROCESSING%' then raise; end if;
    end;
  elsif phase in ('before_2b', 'rollback_2b') then
    if (select provider_destination_id from public.payouts where id='83000000-0000-4000-8000-000000000001') is not null
       or not exists (select 1 from public.payout_claims where payout_id='83000000-0000-4000-8000-000000000001' and provider_destination_id='acct-restored') then
      raise exception '2b predecessor is not the expected missing destination with exact claim evidence';
    end if;
  elsif phase = 'green_2b' then
    if (select provider_destination_id from public.payouts where id='83000000-0000-4000-8000-000000000001') <> 'acct-restored'
       or (select provider_response->>'c2_destination_repaired_at' from public.payouts where id='83000000-0000-4000-8000-000000000001') is null then
      raise exception '2b did not restore the claim-backed destination and marker';
    end if;
  elsif phase = 'before_2c' then
    if position('drape.payout_returned_funds' in pg_get_functiondef(payout_guard)) > 0
       or position('drape.payout_returned_funds' in pg_get_functiondef('private.sync_returned_snapshot_tranche_payout()'::regprocedure)) > 0 then
      raise exception '2c returned-funds guard already exists before the migration';
    end if;
  elsif phase = 'green_2c' then
    if position('drape.payout_returned_funds' in pg_get_functiondef(payout_guard)) = 0
       or position('drape.payout_returned_funds' in pg_get_functiondef('private.sync_returned_snapshot_tranche_payout()'::regprocedure)) = 0 then
      raise exception '2c returned-funds permission boundary is absent';
    end if;
    update public.payout_claims
    set status='FAILED_RECONCILED', transfer_status='FAILED_RECONCILED'
    where id='83000000-0000-4000-8000-000000000012';
    if (select status::text from public.payouts where id='83000000-0000-4000-8000-000000000002') <> 'FAILED'
       or (select completed_at from public.payouts where id='83000000-0000-4000-8000-000000000002') is not null
       or (select provider_response->>'terminal_outcome' from public.payouts where id='83000000-0000-4000-8000-000000000002') <> 'FAILED_RETURNED'
       or (select count(*) from public.ops_issues where dedupe_key='stripe-tranche-reconcile:tranche-1') <> 1 then
      raise exception '2c did not atomically record returned-funds terminal state and Ops issue';
    end if;
  elsif phase = 'red_2c' then
    update public.payout_claims
    set status='FAILED_RECONCILED', transfer_status='FAILED_RECONCILED'
    where id='83000000-0000-4000-8000-000000000012';
    if (select status::text from public.payouts where id='83000000-0000-4000-8000-000000000002') <> 'PAID'
       or (select provider_response->>'terminal_outcome' from public.payouts where id='83000000-0000-4000-8000-000000000002') is not null
       or not exists (select 1 from public.ops_issues where dedupe_key='stripe-tranche-reconcile:tranche-1') then
      raise exception '2c predecessor unexpectedly reconciled a returned PAID payout';
    end if;
  elsif phase = 'rollback_2c' then
    if (select status::text from public.payouts where id='83000000-0000-4000-8000-000000000002') <> 'PAID'
       or (select completed_at from public.payouts where id='83000000-0000-4000-8000-000000000002') is null
       or (select status from public.payout_claims where id='83000000-0000-4000-8000-000000000012') <> 'PROVIDER_PENDING'
       or exists (select 1 from public.ops_issues where dedupe_key='stripe-tranche-reconcile:tranche-1') then
      raise exception '2c rollback changed payout or claim evidence';
    end if;
  elsif phase = 'readiness_red' then
    if readiness_rpc is not null then raise exception 'readiness RPC unexpectedly exists before 20261030154721'; end if;
    if (select payout_account_verified from public.tailor_profiles where id='qa-profile-readiness')
       or not (select payout_reverification_required from public.tailor_profiles where id='qa-profile-readiness') then
      raise exception 'readiness baseline profile changed';
    end if;
  elsif phase = 'readiness_green' then
    if readiness_rpc is null
       or not (select prosecdef from pg_proc where oid=readiness_rpc)
       or not (select proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid=readiness_rpc)
       or (select pg_get_userbyid(proowner) from pg_proc where oid=readiness_rpc) <> 'postgres'
       or not has_function_privilege('service_role', readiness_rpc, 'EXECUTE')
       or has_function_privilege('anon', readiness_rpc, 'EXECUTE')
       or has_function_privilege('authenticated', readiness_rpc, 'EXECUTE') then
      raise exception 'readiness RPC security mode, owner, search_path, or grants are wrong';
    end if;
    if not (select payout_account_verified from public.tailor_profiles where id='qa-profile-readiness')
       or (select payout_reverification_required from public.tailor_profiles where id='qa-profile-readiness')
       or (select payout_account_verified_at from public.tailor_profiles where id='qa-profile-readiness') <> '2026-11-12 12:02:00+00'::timestamptz
       or (select payout_country_code from public.tailor_profiles where id='qa-profile-readiness') <> 'US' then
      raise exception 'readiness fixture does not show expected transition';
    end if;
  elsif phase = 'readiness_rollback' then
    if readiness_rpc is not null then raise exception 'readiness transaction rollback left function or grants behind'; end if;
    if (select payout_account_verified from public.tailor_profiles where id='qa-profile-readiness')
       or not (select payout_reverification_required from public.tailor_profiles where id='qa-profile-readiness') then
      raise exception 'readiness rollback changed profile state';
    end if;
  else
    raise exception 'unknown C2 recovery phase: %', phase;
  end if;
end;
$rehearsal$;
