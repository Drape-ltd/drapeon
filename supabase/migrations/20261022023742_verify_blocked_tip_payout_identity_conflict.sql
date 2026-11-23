do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.tip_money_operation_claims'::regclass
      and conname='tip_money_operation_claims_status_check'
      and pg_get_constraintdef(oid) like '%BLOCKED_IDENTITY%'
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid='public.tip_money_operation_claims'::regclass
      and tgname='tip_money_blocked_identity_guard' and not tgisinternal
  ) then
    raise exception 'Blocked tip payout identity state is not guarded';
  end if;
  if not has_function_privilege('service_role',
      'public.block_tip_payout_identity_conflict(uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('anon',
      'public.block_tip_payout_identity_conflict(uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated',
      'public.block_tip_payout_identity_conflict(uuid,text,jsonb)','EXECUTE') then
    raise exception 'Tip payout conflict block must be service-only';
  end if;
end;
$$;
