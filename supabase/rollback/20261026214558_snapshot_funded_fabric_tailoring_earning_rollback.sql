-- Revert only the route-acceptance function body. Accepted order snapshots
-- remain immutable and are not rewritten.
do $rollback$
declare
  target_function regprocedure := to_regprocedure(
    'public.accept_active_order_quote_with_route_snapshot(text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text)'
  );
  definition text;
  patched text;
  new_assignment constant text := $replacement$accepted_earning_amount = case
        when v_quote.fabric_funding_policy_version in ('fabric-funding-2026-08-01-v1', 'fabric-funding-2026-08-21-v2')
          then v_quote.tailoring_amount
        else v_quote.subtotal_amount
      end,$replacement$;
  old_assignment constant text := 'accepted_earning_amount = v_quote.subtotal_amount,';
begin
  if target_function is null then
    raise exception 'Route acceptance function is unavailable.' using errcode = '55000';
  end if;

  select pg_get_functiondef(target_function) into definition;
  if definition is null
    or length(definition) - length(replace(definition, new_assignment, '')) <> length(new_assignment) then
    raise exception 'Expected exactly one corrected earning snapshot assignment.' using errcode = '55000';
  end if;

  patched := replace(definition, new_assignment, old_assignment);
  if patched = definition then
    raise exception 'Could not restore the pre-correction route acceptance function.' using errcode = '55000';
  end if;

  execute patched;
end;
$rollback$;
