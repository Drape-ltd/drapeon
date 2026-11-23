-- Run after A2, the queue fixture, and the feature migration, for both IDs.
do $$
declare
  v_id text := '10000000-0000-0000-0000-0000000000a1';
  v_user text := '00000000-0000-0000-0000-0000000000a1';
  v_result jsonb;
begin
  insert into public.tailor_profiles (id, user_id, display_name, supports_custom_orders,
    is_verified, is_live, id_verification_status)
  values ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1',
    'Explore proof', true, true, true, 'VERIFIED');
  insert into public.orders values ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'IN_PROGRESS');
  insert into public.messages values ('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1');
  insert into public.consultations values ('40000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1');
  insert into public.payouts values ('50000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1');
  insert into public.saved_sellers values ('60000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1');
  insert into public.seller_items values ('70000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', true);
  v_result := public.ops_set_marketplace_category(v_id, 'READY_TO_WEAR',
    'Curated into the finished-piece aisle', 'ops-qa', 'explore-proof-ready');
  if v_result->>'changed' <> 'true' then raise exception 'Ops move did not change section'; end if;
  v_result := public.ops_set_marketplace_category(v_id, 'READY_TO_WEAR',
    'Curated into the finished-piece aisle', 'ops-qa', 'explore-proof-ready');
  if v_result->>'replayed' <> 'true' then raise exception 'Ops replay was not idempotent'; end if;
  v_result := public.ops_set_marketplace_category(v_id, 'TAILORING',
    'Custom work remains open for this seller', 'ops-qa', 'explore-proof-tailors');
  if v_result->>'changed' <> 'true' then raise exception 'Ops return did not change section'; end if;
  update public.tailor_profiles set supports_custom_orders = false where id::text = v_id;
  if (select marketplace_category from public.tailor_profiles where id::text = v_id) <> 'READY_TO_WEAR' then
    raise exception 'Turning off custom work did not move the listing';
  end if;
  if (select count(*) from public.marketplace_category_decisions where tailor_profile_id::text = v_id) <> 3 then
    raise exception 'Expected two Ops decisions and one auto decision';
  end if;
  if (select count(*) from public.ops_issues where tailor_profile_id = v_id and issue_type='EXPLORE_SECTION_AUTO_MOVE') <> 1 then
    raise exception 'Auto move did not open exactly one Ops case';
  end if;
  if (select count(*) from public.ops_audit_logs where action_taken='EXPLORE_SECTION_AUTO_MOVE') <> 1 then
    raise exception 'Auto case lacks its audit';
  end if;
  if (select count(*) from public.job_queue where payload->>'userId'=v_user and job_type in ('SEND_PUSH','SEND_ACCOUNT_EVENT_EMAIL')) <> 6 then
    raise exception 'Expected one push and one email for each of three moves';
  end if;
  if exists (select 1 from public.job_queue where payload->>'userId'=v_user
      and (payload->>'eventType' is distinct from 'explore_section_moved'
        or payload->>'exploreSectionMove' not in ('TAILORING', 'READY_TO_WEAR'))) then
    raise exception 'Move jobs do not carry the exact worker event contract';
  end if;
  if exists(select 1 from public.job_queue where payload ? 'reason') then
    raise exception 'Internal move reason leaked to notification queue';
  end if;
  if not exists (select 1 from public.orders where tailor_id::text=v_user and stage='IN_PROGRESS')
    or not exists (select 1 from public.messages where tailor_id::text=v_user)
    or not exists (select 1 from public.consultations where tailor_id::text=v_user)
    or not exists (select 1 from public.payouts where tailor_id::text=v_user)
    or not exists (select 1 from public.saved_sellers where tailor_profile_id::text=v_id) then
    raise exception 'A discovery move changed an existing relationship';
  end if;
  if not exists (select 1 from public.seller_items where tailor_profile_id::text=v_id and is_live)
    or not exists (select 1 from public.tailor_profiles where id::text=v_id
      and is_live and marketplace_category='READY_TO_WEAR') then
    raise exception 'Discovery move lost a public shop or ready-made item';
  end if;
  update public.tailor_profiles set supports_custom_orders = false where id::text = v_id;
  if (select count(*) from public.marketplace_category_decisions where tailor_profile_id::text = v_id) <> 3 then
    raise exception 'Repeated save added a decision';
  end if;
  insert into public.tailor_profiles (id, user_id, display_name, supports_custom_orders)
  values ('10000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a5',
    'First approval proof', true);
  perform public.ops_decide_verification('00000000-0000-0000-0000-0000000000a5',
    'APPROVE', 'Curated at first approval', null, 'READY_TO_WEAR', 'ops-qa');
  if exists (select 1 from public.domain_events where event_type='explore_section_moved'
      and aggregate_id='10000000-0000-0000-0000-0000000000a5')
    or exists (select 1 from public.job_queue where payload->>'userId'='00000000-0000-0000-0000-0000000000a5') then
    raise exception 'First approval incorrectly queued a second section-move notice';
  end if;
  if (select count(*) from public.marketplace_category_decisions
      where tailor_profile_id::text='10000000-0000-0000-0000-0000000000a5') <> 1 then
    raise exception 'First approval did not leave exactly one placement decision';
  end if;
  raise notice 'PASS: first trust approval adds no Explore section move event';
  begin
    perform public.ops_set_marketplace_category(v_id, 'TAILORING',
      'This must be rejected while custom orders are off', 'ops-qa', 'explore-proof-ineligible');
    raise exception 'Tailors accepted a seller without custom work';
  exception when check_violation then null;
  end;
  insert into public.tailor_profiles (id, user_id, display_name, supports_custom_orders,
    is_verified, is_live, id_verification_status, id_verified_at)
  values ('10000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2',
    'Previously approved proof', true, false, false, 'SUSPENDED', now());
  v_result := public.ops_set_marketplace_category('10000000-0000-0000-0000-0000000000a2',
    'READY_TO_WEAR', 'Curated while trust review is separate', 'ops-qa', 'explore-proof-suspended');
  if v_result->>'changed' <> 'true' then raise exception 'A suspended, previously approved seller could not move'; end if;
  insert into public.tailor_profiles (id, user_id, display_name, supports_custom_orders,
    is_verified, is_live, id_verification_status)
  values ('10000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a4',
    'No items proof', true, true, true, 'VERIFIED');
  perform public.ops_set_marketplace_category('10000000-0000-0000-0000-0000000000a4',
    'READY_TO_WEAR', 'Curated without any finished items', 'ops-qa', 'explore-proof-no-items');
  if not exists (select 1 from public.tailor_profiles where id::text='10000000-0000-0000-0000-0000000000a4'
      and is_live and marketplace_category='READY_TO_WEAR')
    or exists (select 1 from public.seller_items where tailor_profile_id::text='10000000-0000-0000-0000-0000000000a4') then
    raise exception 'A seller with no items vanished from Ready-made';
  end if;
  insert into public.tailor_profiles (id, user_id, display_name, supports_custom_orders,
    is_verified, is_live, id_verification_status, is_test_profile)
  values ('10000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a6',
    'QA auto move proof', true, true, true, 'VERIFIED', true);
  update public.tailor_profiles set supports_custom_orders = false
  where id::text = '10000000-0000-0000-0000-0000000000a6';
  if (select provenance from public.ops_issues
      where tailor_profile_id='10000000-0000-0000-0000-0000000000a6'
        and issue_type='EXPLORE_SECTION_AUTO_MOVE') <> 'QA' then
    raise exception 'Test seller auto-move created a real Ops case';
  end if;
  raise notice 'PASS: a test seller auto-move creates a QA case';
  insert into public.tailor_profiles (id, user_id, display_name, supports_custom_orders)
  values ('10000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a3', 'Pending proof', true);
  begin
    perform public.ops_set_marketplace_category('10000000-0000-0000-0000-0000000000a3',
      'READY_TO_WEAR', 'This pending seller must be refused', 'ops-qa', 'explore-proof-pending');
    raise exception 'Pending seller was moved';
  exception when check_violation then null;
  end;
  raise notice 'PASS: Ops moves, auto move, case, audit, queued notices, and repeat';
end;
$$;
