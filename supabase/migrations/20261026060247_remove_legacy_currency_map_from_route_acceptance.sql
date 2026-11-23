-- Route acceptance must validate the resolved, versioned route snapshot rather
-- than run a second currency→provider decision through the legacy helper.
-- Keep the historical helper installed for the profile metadata trigger until
-- that independent legacy dependency is retired.
do $$
declare
  target_function regprocedure := to_regprocedure(
    'public.accept_active_order_quote_with_route_snapshot(text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text)'
  );
  definition text;
  patched text;
  legacy_check constant text := $pattern$v_route\.provider is distinct from public\.resolve_payment_provider_for_currency\([[:space:]]*v_route\.charge_currency::public\.currency[[:space:]]*\)::text[[:space:]]+or[[:space:]]+$pattern$;
begin
  if target_function is null then
    raise exception 'Route acceptance function is unavailable.' using errcode = '55000';
  end if;

  select pg_get_functiondef(target_function) into definition;
  if definition is null or definition !~ legacy_check then
    raise exception 'Expected legacy currency-provider check was not found.' using errcode = '55000';
  end if;

  patched := regexp_replace(definition, legacy_check, '', 'g');
  if patched = definition
    or patched ~ 'public\.resolve_payment_provider_for_currency\('
    or patched !~ 'v_route\.provider is distinct from v_order\.tailor_payout_provider_locked::text' then
    raise exception 'Route acceptance resolver correction did not produce the expected definition.' using errcode = '55000';
  end if;

  execute patched;
end;
$$;
