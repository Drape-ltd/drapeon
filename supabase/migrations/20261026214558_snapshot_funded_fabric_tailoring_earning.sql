-- Funded-fabric quote subtotal includes a protected allowance that is not
-- tailor earnings. Keep accepted_earning_amount aligned with the locked
-- tailoring allocation, while legacy quotes continue to snapshot subtotal.
do $migration$
declare
  target_function regprocedure := to_regprocedure(
    'public.accept_active_order_quote_with_route_snapshot(text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text)'
  );
  definition text;
  patched text;
  old_assignment constant text := 'accepted_earning_amount = v_quote.subtotal_amount,';
  new_assignment constant text := $replacement$accepted_earning_amount = case
        when v_quote.fabric_funding_policy_version in ('fabric-funding-2026-08-01-v1', 'fabric-funding-2026-08-21-v2')
          then v_quote.tailoring_amount
        else v_quote.subtotal_amount
      end,$replacement$;
begin
  if target_function is null then
    raise exception 'Route acceptance function is unavailable.' using errcode = '55000';
  end if;

  select pg_get_functiondef(target_function) into definition;
  if definition is null
    or length(definition) - length(replace(definition, old_assignment, '')) <> length(old_assignment) then
    raise exception 'Expected exactly one legacy earning snapshot assignment.' using errcode = '55000';
  end if;

  patched := replace(definition, old_assignment, new_assignment);
  if patched = definition
    or patched !~ 'then[[:space:]]+v_quote\.tailoring_amount'
    or patched !~ 'else[[:space:]]+v_quote\.subtotal_amount' then
    raise exception 'Funded-fabric earning snapshot correction failed validation.' using errcode = '55000';
  end if;

  execute patched;
end;
$migration$;
