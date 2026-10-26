-- Restore the former provisional provider-lock comparisons only if the
-- forward correction is still active in both snapshot RPCs.
do $$
declare
  function_signature text;
  target_function regprocedure;
  definition text;
  patched text;
  first_route_check constant text := $fragment$if v_route.tailor_country_code <> upper(coalesce(v_profile.payout_country_code, ''))$fragment$;
  restored_route_check constant text := $fragment$if v_route.provider is distinct from v_order.tailor_payout_provider_locked::text
    or v_route.tailor_country_code <> upper(coalesce(v_profile.payout_country_code, ''))$fragment$;
  legacy_provider_check constant text := $pattern$v_route\.provider is distinct from v_order\.tailor_payout_provider_locked::text$pattern$;
  changed_functions integer := 0;
begin
  foreach function_signature in array array[
    'public.accept_active_order_quote_with_route_snapshot(text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text)',
    'public.snapshot_ready_made_payment_route(text,uuid,uuid,integer,uuid,integer,uuid,text,text)'
  ] loop
    target_function := to_regprocedure(function_signature);
    if target_function is null then
      raise exception 'Route snapshot function % is unavailable.', function_signature using errcode = '55000';
    end if;
    select pg_get_functiondef(target_function) into definition;
    if definition is null
      or definition ~ legacy_provider_check
      or definition !~ first_route_check then
      raise exception 'Route snapshot function % is not in the expected post-migration state.', function_signature using errcode = '55000';
    end if;
    patched := replace(definition, first_route_check, restored_route_check);
    if patched = definition or patched !~ legacy_provider_check then
      raise exception 'Could not restore the provisional provider lock for %.', function_signature using errcode = '55000';
    end if;
    execute patched;
    changed_functions := changed_functions + 1;
  end loop;
  if changed_functions <> 2 then
    raise exception 'Expected two route snapshot functions to be rolled back.' using errcode = '55000';
  end if;
end;
$$;
