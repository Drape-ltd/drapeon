-- Prove the Ops move works with both text and uuid profile IDs, records one
-- decision, replays idempotently, and reports malformed UUID IDs cleanly.
\set ON_ERROR_STOP on

do $$
declare
  v_profile_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_idempotency_key text := 'uuid-compat:' || gen_random_uuid()::text;
  v_result jsonb;
  v_is_uuid boolean;
  v_id_type text;
  v_error text;
begin
  select a.atttypid = 'uuid'::regtype, format_type(a.atttypid, a.atttypmod)
    into v_is_uuid, v_id_type
  from pg_attribute a
  where a.attrelid = 'public.tailor_profiles'::regclass
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  execute format(
    'insert into public.tailor_profiles (id, user_id, display_name, supports_custom_orders) values ($1::%s, $2::%s, $3, true)',
    v_id_type,
    v_id_type
  ) using v_profile_id::text, v_user_id::text, 'ID compatibility probe';

  v_result := public.ops_set_marketplace_category(
    v_profile_id::text,
    'READY_TO_WEAR',
    'Compatibility move test',
    'qa-ops',
    v_idempotency_key
  );
  if v_result ->> 'changed' <> 'true' then
    raise exception 'FAIL: Ops move did not report a category change';
  end if;
  if not exists (
    select 1
    from public.tailor_profiles
    where id::text = v_profile_id::text
      and marketplace_category::text = 'READY_TO_WEAR'
  ) then
    raise exception 'FAIL: Ops move did not update the profile';
  end if;
  if (select count(*) from public.marketplace_category_decisions
      where tailor_profile_id::text = v_profile_id::text
        and idempotency_key = v_idempotency_key) <> 1 then
    raise exception 'FAIL: Ops move did not write exactly one decision';
  end if;

  v_result := public.ops_set_marketplace_category(
    v_profile_id::text,
    'READY_TO_WEAR',
    'Compatibility move test',
    'qa-ops',
    v_idempotency_key
  );
  if v_result ->> 'replayed' <> 'true'
    or (select count(*) from public.marketplace_category_decisions
        where idempotency_key = v_idempotency_key) <> 1 then
    raise exception 'FAIL: Ops move replay was not idempotent';
  end if;

  if v_is_uuid then
    begin
      perform public.ops_set_marketplace_category(
        'not-a-uuid',
        'READY_TO_WEAR',
        'Compatibility invalid ID test',
        'qa-ops',
        'uuid-invalid:' || gen_random_uuid()::text
      );
      raise exception 'FAIL: invalid UUID profile ID was accepted';
    exception when sqlstate '22023' then
      get stacked diagnostics v_error = message_text;
      if v_error <> 'Invalid profile ID' then
        raise exception 'FAIL: invalid UUID profile ID returned the wrong error: %', v_error;
      end if;
    end;
  end if;

  delete from public.tailor_profiles where id::text = v_profile_id::text;
  delete from public.audit_logs where payload ->> 'idempotency_key' = v_idempotency_key;
end;
$$;

do $$ begin raise notice 'PASS: Ops category move supports this profile ID type'; end $$;
