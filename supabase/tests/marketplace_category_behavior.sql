\set ON_ERROR_STOP on

insert into public.tailor_profiles (id, display_name)
values ('maker_test_0001', 'Test Maker');

set role authenticated;
do $$
begin
  begin
    update public.tailor_profiles set marketplace_category = 'STREETWEAR' where id = 'maker_test_0001';
    raise exception 'authenticated UPDATE unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.tailor_profiles (display_name, marketplace_category) values ('Rejected Test Maker', 'STREETWEAR');
    raise exception 'authenticated explicit INSERT unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  insert into public.tailor_profiles (id, display_name) values ('maker_test_0002', 'Default Test Maker');
  if (select marketplace_category from public.tailor_profiles where id = 'maker_test_0002') <> 'TAILORING' then
    raise exception 'authenticated default INSERT did not use TAILORING';
  end if;
  begin
    perform public.ops_set_marketplace_category('maker_test_0001', 'STREETWEAR', 'Test classification reason', 'test-actor', 'test-key-0001');
    raise exception 'authenticated RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set role anon;
do $$
begin
  begin
    perform public.ops_set_marketplace_category('maker_test_0001', 'STREETWEAR', 'Test classification reason', 'test-actor', 'test-key-0001');
    raise exception 'anon RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set role service_role;
do $$
declare
  v_result jsonb;
begin
  v_result := public.ops_set_marketplace_category('maker_test_0001', 'STREETWEAR', 'Portfolio is streetwear work', 'test-actor', 'test-key-0001');
  if v_result->>'changed' <> 'true' or v_result->>'replayed' <> 'false' then raise exception 'first decision result was wrong: %', v_result; end if;
  if (select marketplace_category from public.tailor_profiles where id = 'maker_test_0001') <> 'STREETWEAR' then raise exception 'category did not change'; end if;
  v_result := public.ops_set_marketplace_category('maker_test_0001', 'STREETWEAR', 'Portfolio is streetwear work', 'test-actor', 'test-key-0001');
  if v_result->>'replayed' <> 'true' then raise exception 'same-key replay was not reported'; end if;
  begin
    perform public.ops_set_marketplace_category('maker_test_0001', 'TAILORING', 'Different target is invalid', 'test-actor', 'test-key-0001');
    raise exception 'conflicting replay unexpectedly succeeded';
  exception when unique_violation then null;
  end;
  v_result := public.ops_set_marketplace_category('maker_test_0001', 'STREETWEAR', 'Same value must be a no-op', 'test-actor', 'test-key-0002');
  if v_result->>'changed' <> 'false' or v_result->>'replayed' <> 'false' then raise exception 'same-value result was wrong: %', v_result; end if;
  if (select count(*) from public.marketplace_category_decisions) <> 1 then raise exception 'decision count was not exactly one'; end if;
  if (select count(*) from public.audit_logs where event = 'ops.marketplace_category_changed') <> 1 then raise exception 'audit count was not exactly one'; end if;
end;
$$;
reset role;

select 'PASS: guards, grants, mutation, replay, conflict, no-op and audit cardinality' as result;
