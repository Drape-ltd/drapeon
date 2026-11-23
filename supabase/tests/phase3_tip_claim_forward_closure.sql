-- Forward closure must restore the complete TIP claim runtime without exposing it.
do $test$
declare
  v_table regclass := to_regclass('public.tip_money_operation_claims');
  v_name text;
  v_oid oid;
begin
  if v_table is null then
    raise exception 'TIP money operation claim table is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid=v_table) then
    raise exception 'TIP claim RLS is disabled';
  end if;
  if has_table_privilege('anon',v_table,'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated',v_table,'SELECT,INSERT,UPDATE,DELETE')
    or not has_table_privilege('service_role',v_table,'SELECT,INSERT,UPDATE') then
    raise exception 'TIP claim table grants are not service-only';
  end if;
  if not exists (select 1 from pg_constraint
      where conrelid=v_table and conname='tip_money_operation_claims_tip_id_operation_kind_key')
    or not exists (select 1 from pg_indexes
      where schemaname='public' and tablename='tip_money_operation_claims'
        and indexname='tip_money_operation_provider_reference_idx')
    or not exists (select 1 from pg_indexes
      where schemaname='public' and tablename='tip_money_operation_claims'
        and indexname='tip_money_payout_ledger_unique_idx') then
    raise exception 'TIP claim uniqueness guards are missing';
  end if;
  foreach v_name in array array[
    'reserve_tip_money_operation',
    'record_tip_money_operation_outcome',
    'finalize_claimed_tip_refund',
    'finalize_claimed_stripe_tip_payout',
    'finalize_claimed_stripe_tip_payout_core',
    'guard_tip_refund_real_approval',
    'prevent_unreviewed_blocked_tip_claim_transition',
    'prevent_tip_payout_ledger_receipt_rewrite'
  ] loop
    select p.oid into v_oid from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=v_name;
    if v_oid is null or has_function_privilege('anon',v_oid,'EXECUTE')
      or has_function_privilege('authenticated',v_oid,'EXECUTE')
      or not has_function_privilege('service_role',v_oid,'EXECUTE') then
      raise exception 'TIP claim function % is missing or incorrectly granted',v_name;
    end if;
    v_oid := null;
  end loop;
  if (select count(*) from pg_trigger
      where tgrelid=v_table and not tgisinternal and tgenabled='O') <> 3 then
    raise exception 'TIP claim triggers are missing or disabled';
  end if;
end;
$test$;
