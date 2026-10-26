-- Restore the prior lookup expression without changing any accepted quote or
-- allocation data.
do $rollback$
declare
  target_function regprocedure := to_regprocedure(
    'public.lock_fabric_allocation_on_quote_acceptance()'
  );
  definition text;
  patched text;
  new_comparison constant text := 'where order_id::text = new.order_id::text and quote_id = new.id';
  old_comparison constant text := 'where order_id = new.order_id and quote_id = new.id';
begin
  if target_function is null then
    raise exception 'Funded-fabric quote acceptance trigger is unavailable.' using errcode = '55000';
  end if;

  select pg_get_functiondef(target_function) into definition;
  if definition is null
    or length(definition) - length(replace(definition, new_comparison, '')) <> length(new_comparison) then
    raise exception 'Expected exactly one portable fabric-allocation lookup.' using errcode = '55000';
  end if;

  patched := replace(definition, new_comparison, old_comparison);
  if patched = definition then
    raise exception 'Could not restore the prior fabric-allocation lookup.' using errcode = '55000';
  end if;

  execute patched;
end;
$rollback$;
