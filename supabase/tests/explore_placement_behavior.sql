-- Behaviour expected after the three placement migrations.
\set ON_ERROR_STOP on
truncate public.marketplace_category_decisions, public.audit_logs;
delete from public.tailor_profiles;
insert into public.tailor_profiles (id, user_id, display_name, supports_custom_orders) values
  ('10000000-0000-0000-0000-00000000000a',   '00000000-0000-0000-0000-00000000000a', 'Custom tailor', true),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Ready boutique', false),
  ('10000000-0000-0000-0000-00000000000c',   '00000000-0000-0000-0000-00000000000c', 'Rejected seller', true),
  ('10000000-0000-0000-0000-00000000000d',     '00000000-0000-0000-0000-00000000000d', 'Approved tailor', true),
  ('10000000-0000-0000-0000-00000000000e',  '00000000-0000-0000-0000-00000000000e', 'Pending applicant', true);

do $$
declare v_err text;
begin
  -- 1. APPROVE without a placement is refused.
  begin
    perform public.ops_decide_verification('00000000-0000-0000-0000-00000000000a', 'APPROVE');
    raise exception 'FAIL: approve without placement succeeded';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'PLACEMENT_REQUIRED:%' then raise exception 'FAIL: wrong error %', v_err; end if;
  end;
  if (select id_verification_status from public.tailor_profiles where id = '10000000-0000-0000-0000-00000000000a') <> 'PENDING' then
    raise exception 'FAIL: refused approval changed state';
  end if;

  -- 2. A boutique cannot be approved into Tailors, and nothing changes.
  begin
    perform public.ops_decide_verification('00000000-0000-0000-0000-00000000000b', 'APPROVE', null, null, 'TAILORING', 'qa-ops');
    raise exception 'FAIL: boutique approved into Tailors';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'PLACEMENT_REQUIRES_CUSTOM_ORDERS:%' then raise exception 'FAIL: wrong error %', v_err; end if;
  end;
  if (select count(*) from public.marketplace_category_decisions) <> 0
     or (select id_verification_status from public.tailor_profiles where id = '10000000-0000-0000-0000-00000000000b') <> 'PENDING' then
    raise exception 'FAIL: refused boutique approval left changes';
  end if;
  raise notice 'PASS: missing and ineligible placements are refused without changes';

  -- 3. Boutique approved into Ready-to-wear: status, placement and one decision row together.
  perform public.ops_decide_verification('00000000-0000-0000-0000-00000000000b', 'APPROVE', 'Ready-made pieces only', null, 'ready_to_wear', 'qa-ops');
  if (select marketplace_category::text || ':' || id_verification_status || ':' || is_live::text from public.tailor_profiles where id = '10000000-0000-0000-0000-00000000000b')
     <> 'READY_TO_WEAR:VERIFIED:true' then raise exception 'FAIL: boutique approval state'; end if;
  if (select count(*) from public.marketplace_category_decisions where tailor_profile_id = '10000000-0000-0000-0000-00000000000b'
        and from_category = 'TAILORING' and to_category = 'READY_TO_WEAR' and actor = 'qa-ops'
        and reason = 'Placed at trust approval: Ready-made pieces only') <> 1 then
    raise exception 'FAIL: boutique decision row';
  end if;
  if (select payload->>'placement' from public.audit_logs where payload->>'tailor_profile_id' is not null
        and payload->>'decision' = 'APPROVE' order by id desc limit 1) <> 'READY_TO_WEAR' then
    raise exception 'FAIL: audit placement';
  end if;

  -- 4. Custom tailor approved into Tailors records an explicit decision even with no category change.
  perform public.ops_decide_verification('00000000-0000-0000-0000-00000000000a', 'APPROVE', null, null, 'TAILORING', null);
  if (select count(*) from public.marketplace_category_decisions where tailor_profile_id = '10000000-0000-0000-0000-00000000000a'
        and from_category = 'TAILORING' and to_category = 'TAILORING' and actor = 'ops'
        and reason = 'Placed at trust approval') <> 1 then
    raise exception 'FAIL: tailor decision row';
  end if;
  raise notice 'PASS: approval sets status and placement with one decision row';

  -- 5. REJECT ignores placement and writes no decision row.
  perform public.ops_decide_verification('00000000-0000-0000-0000-00000000000c', 'REJECT', 'Portfolio needs real work samples', null, 'READY_TO_WEAR', 'qa-ops');
  if (select count(*) from public.marketplace_category_decisions where tailor_profile_id = '10000000-0000-0000-0000-00000000000c') <> 0
     or (select marketplace_category::text from public.tailor_profiles where id = '10000000-0000-0000-0000-00000000000c') <> 'TAILORING' then
    raise exception 'FAIL: reject touched placement';
  end if;
  raise notice 'PASS: reject ignores placement';

  -- 6. Ops moves enforce eligibility; a valid move is recorded.
  begin
    perform public.ops_set_marketplace_category('10000000-0000-0000-0000-00000000000b', 'TAILORING', 'Move back to the tailors aisle', 'qa-ops', 'move-boutique-1');
    raise exception 'FAIL: boutique moved into Tailors';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'PLACEMENT_REQUIRES_CUSTOM_ORDERS:%' then raise exception 'FAIL: wrong move error %', v_err; end if;
  end;
  perform public.ops_set_marketplace_category('10000000-0000-0000-0000-00000000000a', 'READY_TO_WEAR', 'Work suits the ready-to-wear aisle', 'qa-ops', 'move-tailor-1');
  perform public.ops_set_marketplace_category('10000000-0000-0000-0000-00000000000a', 'TAILORING', 'Custom work reviewed again for Tailors', 'qa-ops', 'move-tailor-2');
  if (select count(*) from public.marketplace_category_decisions where tailor_profile_id = '10000000-0000-0000-0000-00000000000a') <> 3 then
    raise exception 'FAIL: move history';
  end if;
  raise notice 'PASS: Ops moves enforce eligibility and keep history';
end $$;

-- 7. A seller in Tailors cannot switch custom orders off; a pending applicant can.
update public.tailor_profiles set id_verification_status = 'VERIFIED', is_verified = true, is_live = true where id = '10000000-0000-0000-0000-00000000000d';
set role authenticated;
do $$
declare v_err text;
begin
  begin
    update public.tailor_profiles set supports_custom_orders = false where id = '10000000-0000-0000-0000-00000000000d';
    raise exception 'FAIL: approved Tailors seller turned custom orders off';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'PLACEMENT_REQUIRES_CUSTOM_ORDERS:%' then raise exception 'FAIL: wrong seller error %', v_err; end if;
  end;
  update public.tailor_profiles set supports_custom_orders = false where id = '10000000-0000-0000-0000-00000000000e';
  update public.tailor_profiles set display_name = 'Ready boutique renamed' where id = '10000000-0000-0000-0000-00000000000b';
end $$;
reset role;
do $$ begin raise notice 'PASS: seller-side guard blocks only approved Tailors sellers'; end $$;

-- 8. The renamed enum value is the only secondary placement.
do $$
begin
  if (select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'marketplace_category') <> 'TAILORING,READY_TO_WEAR' then
    raise exception 'FAIL: enum labels';
  end if;
  if exists (select 1 from pg_proc where proname = 'ops_decide_verification'
      and pg_get_function_identity_arguments(oid) = 'p_tailor_user_id uuid, p_decision text, p_reason text, p_rejection_code text') then
    raise exception 'FAIL: four-argument approval still exists';
  end if;
  if has_function_privilege('authenticated', 'public.ops_decide_verification(uuid,text,text,text,text,text)', 'execute') then
    raise exception 'FAIL: approval executable by authenticated';
  end if;
  raise notice 'PASS: enum renamed, old approval signature gone, service-only grant';
end $$;
