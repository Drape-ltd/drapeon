do $$
declare
  v_guard text;
  v_trigger record;
begin
  if to_regprocedure('private.guard_snapshot_destination_correction_prior_destination()') is null then
    raise exception 'Snapshot destination correction identity guard is missing';
  end if;

  select pg_get_functiondef(
    'private.guard_snapshot_destination_correction_prior_destination()'::regprocedure
  ) into v_guard;
  if position('v_payout.provider_destination_id is distinct from v_previous.provider_account_ref' in v_guard)=0
    or position('v_prior_operation.provider_destination_id is distinct from v_previous.provider_account_ref' in v_guard)=0
    or position('v_prior_operation.status is distinct from ''FAILED_RETURNED''' in v_guard)=0
    or position('v_claim.tailor_profile_id is distinct from v_order.tailor_profile_id::text' in v_guard)=0
    or position('v_previous.tailor_profile_id::text is distinct from v_order.tailor_profile_id::text' in v_guard)=0
    or position('v_replacement.tailor_profile_id::text is distinct from v_order.tailor_profile_id::text' in v_guard)=0
    or position('v_route.provider::text is distinct from v_order.charge_provider_snapshot' in v_guard)=0
    or position('v_route.payout_currency is distinct from v_claim.currency::text' in v_guard)=0
    or position('v_prior_operation.funds_return_confirmed_at is null' in v_guard)=0
    or position('v_claim.amount is distinct from v_payout.amount' in v_guard)=0
    or position('v_claim.currency is distinct from v_payout.currency' in v_guard)=0 then
    raise exception 'Snapshot correction does not bind the route, tailor, replacement destination, failed payout, and returned operation';
  end if;

  select tg.tgname, tg.tgenabled, p.proconfig, p.prosecdef
    into v_trigger
    from pg_trigger tg
    join pg_proc p on p.oid=tg.tgfoid
    where tg.tgrelid='public.payout_destination_corrections'::regclass
      and tg.tgname='payout_destination_correction_prior_destination_guard'
      and not tg.tgisinternal;
  if v_trigger.tgname is null or v_trigger.tgenabled<>'O'
    or coalesce(v_trigger.prosecdef,true)
    or not coalesce(v_trigger.proconfig @> array['search_path=""'],false) then
    raise exception 'Snapshot correction identity trigger is missing, disabled, or not invoker-safe';
  end if;

  if has_function_privilege('anon','private.guard_snapshot_destination_correction_prior_destination()','EXECUTE')
    or has_function_privilege('authenticated','private.guard_snapshot_destination_correction_prior_destination()','EXECUTE') then
    raise exception 'Snapshot correction identity trigger must not be client executable';
  end if;
  if has_function_privilege('service_role','private.guard_snapshot_destination_correction_prior_destination()','EXECUTE') then
    raise exception 'Snapshot correction trigger function must not be directly executable by service_role';
  end if;
end;
$$;
