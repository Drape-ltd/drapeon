-- On newly accepted orders, the configured route is the source of truth. The
-- legacy provider lock is provisional profile metadata and must not veto it.
-- Snapshot RPCs still validate currencies, destination, entity and readiness,
-- then overwrite the legacy lock from the selected route.
do $$
declare
  function_signature text;
  target_function regprocedure;
  definition text;
  patched text;
  legacy_lock_check constant text := $pattern$v_route\.provider is distinct from v_order\.tailor_payout_provider_locked::text[[:space:]]+or[[:space:]]+$pattern$;
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
    if definition is null or definition !~ legacy_lock_check then
      raise exception 'Expected provisional provider-lock check was not found in %.', function_signature using errcode = '55000';
    end if;
    patched := regexp_replace(definition, legacy_lock_check, '', 'g');
    if patched = definition
      or patched !~ 'v_route\.provider[[:space:]]*<>[[:space:]]*v_destination\.provider' then
      raise exception 'Route provider correction failed validation for %.', function_signature using errcode = '55000';
    end if;
    execute patched;
    changed_functions := changed_functions + 1;
  end loop;
  if changed_functions <> 2 then
    raise exception 'Expected two route snapshot functions to be corrected.' using errcode = '55000';
  end if;
end;
$$;
