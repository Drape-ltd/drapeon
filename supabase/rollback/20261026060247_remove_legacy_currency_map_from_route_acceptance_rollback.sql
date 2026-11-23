-- Restore the redundant map check only if the forward migration is still active.
do $$
declare
  target_function regprocedure := to_regprocedure(
    'public.accept_active_order_quote_with_route_snapshot(text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text)'
  );
  definition text;
  patched text;
  insertion constant text := E'  if v_route.provider is distinct from v_order.tailor_payout_provider_locked::text\n';
  legacy_check constant text := E'  if v_route.provider is distinct from v_order.tailor_payout_provider_locked::text\n    or v_route.provider is distinct from public.resolve_payment_provider_for_currency(\n      v_route.charge_currency::public.currency\n    )::text\n';
begin
  if target_function is null then
    raise exception 'Route acceptance function is unavailable.' using errcode = '55000';
  end if;

  select pg_get_functiondef(target_function) into definition;
  if definition is null
    or definition ~ 'public\.resolve_payment_provider_for_currency\('
    or definition !~ 'v_route\.provider is distinct from v_order\.tailor_payout_provider_locked::text' then
    raise exception 'Route acceptance function is not in the expected post-migration state.' using errcode = '55000';
  end if;

  patched := replace(definition, insertion, legacy_check);
  if patched = definition then
    raise exception 'Could not restore the legacy route check.' using errcode = '55000';
  end if;
  execute patched;
end;
$$;
