select set_config('test.expect_client_grants', :'EXPECT_CLIENT_GRANTS', false);
select set_config('test.expect_a1b_index', :'EXPECT_A1B_INDEX', false);

do $$
declare
  v_role text;
  v_privilege text;
  v_expect_client_grants boolean := current_setting('test.expect_client_grants')::boolean;
  v_expect_index boolean := current_setting('test.expect_a1b_index')::boolean;
  v_index_definition text;
  v_policy_count integer;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_privilege in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege(v_role, 'public.marketplace_category_decisions', v_privilege) is distinct from v_expect_client_grants then
        raise exception 'Unexpected % privilege % on marketplace_category_decisions.', v_role, v_privilege;
      end if;
    end loop;
    if has_function_privilege(v_role, 'public.guard_tailor_marketplace_category()', 'execute') is distinct from v_expect_client_grants then
      raise exception 'Unexpected EXECUTE privilege for % on guard_tailor_marketplace_category().', v_role;
    end if;
  end loop;

  if not has_table_privilege('service_role', 'public.marketplace_category_decisions', 'select') then
    raise exception 'service_role must retain SELECT on marketplace_category_decisions.';
  end if;
  if has_table_privilege('service_role', 'public.marketplace_category_decisions', 'insert') is distinct from v_expect_index then
    raise exception 'Unexpected service_role INSERT grant state.';
  end if;
  if not has_function_privilege('service_role', 'public.guard_tailor_marketplace_category()', 'execute') then
    raise exception 'service_role must retain EXECUTE on guard_tailor_marketplace_category().';
  end if;

  select pg_get_indexdef(to_regclass('public.marketplace_category_decisions_profile_created_idx'))
    into v_index_definition;
  if v_expect_index then
    if v_index_definition is null or lower(v_index_definition) not like '%(tailor_profile_id, created_at desc)%' then
      raise exception 'A1b FK history index is missing or has the wrong definition: %', v_index_definition;
    end if;
  elsif v_index_definition is not null then
    raise exception 'A1b rollback should remove its FK history index.';
  end if;

  if not exists (
    select 1 from pg_class c
    where c.oid = 'public.marketplace_category_decisions'::regclass
      and c.relrowsecurity
  ) then
    raise exception 'RLS must remain enabled on marketplace_category_decisions.';
  end if;
  select count(*) into v_policy_count
  from pg_policy p
  where p.polrelid = 'public.marketplace_category_decisions'::regclass;
  if v_policy_count <> 0 then
    raise exception 'The marketplace decision table must remain deny-all with no RLS policies.';
  end if;

  if v_expect_index and obj_description('public.marketplace_category_decisions'::regclass, 'pg_class')
    <> 'Ops placement history. Service-role only; RLS stays enabled with no policies so client roles read nothing.' then
    raise exception 'A1b must document the intentional RLS-with-no-policy deny-all contract.';
  end if;
end;
$$;
