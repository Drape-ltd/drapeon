do $$
declare
  v_migration_count integer;
  v_function_oid oid;
  v_function_config text[];
  v_function_is_definer boolean;
begin
  select count(*) into v_migration_count
  from supabase_migrations.schema_migrations
  where version = '20261028140403';
  if v_migration_count <> 1 then
    raise exception 'Reviewed Bachs refund retry migration is missing or duplicated';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_payment_refund_attempts'
      and column_name = 'money_desk_request_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_payment_refund_attempts'
      and column_name = 'reviewed_retry_of_attempt_id'
  ) then
    raise exception 'Reviewed retry identity columns are missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'order_payment_refund_attempts_review_request_uidx'
      and indexdef ilike '%unique%'
  ) then
    raise exception 'A reviewed Money Desk request is not unique per retry attempt';
  end if;

  select p.oid, p.proconfig, p.prosecdef
  into v_function_oid, v_function_config, v_function_is_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'reserve_bachs_payment_refund_retry_attempt'
    and pg_get_function_identity_arguments(p.oid) =
      'p_claim_id uuid, p_failed_attempt_id uuid, p_money_desk_request_id uuid';
  if v_function_oid is null or v_function_is_definer then
    raise exception 'Reviewed retry reservation RPC is missing or unexpectedly SECURITY DEFINER';
  end if;
  if not ('search_path=""' = any(coalesce(v_function_config, array[]::text[]))) then
    raise exception 'Reviewed retry reservation RPC must use an empty search_path';
  end if;
  if has_function_privilege('anon', v_function_oid, 'EXECUTE')
    or has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
    or not has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception 'Reviewed retry reservation RPC grants are not service-role-only';
  end if;
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'order_payment_refund_attempts'
      and t.tgname = 'order_payment_refund_attempt_guard'
      and not t.tgisinternal
  ) then
    raise exception 'Immutable refund attempt guard is missing';
  end if;
end;
$$;
