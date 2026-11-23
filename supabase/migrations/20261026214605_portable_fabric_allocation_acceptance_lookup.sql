-- order_fabric_funding_allocations stores order IDs as text while local and
-- remote schemas may expose orders.id as UUID or text. Compare the portable
-- textual identity so quote acceptance works in either schema shape.
do $migration$
declare
  target_function regprocedure := to_regprocedure(
    'public.lock_fabric_allocation_on_quote_acceptance()'
  );
  definition text;
  patched text;
  old_comparison constant text := 'where order_id = new.order_id and quote_id = new.id';
  new_comparison constant text := 'where order_id::text = new.order_id::text and quote_id = new.id';
begin
  if target_function is null then
    raise exception 'Funded-fabric quote acceptance trigger is unavailable.' using errcode = '55000';
  end if;

  select pg_get_functiondef(target_function) into definition;
  if definition is null
    or length(definition) - length(replace(definition, old_comparison, '')) <> length(old_comparison) then
    raise exception 'Expected exactly one non-portable fabric-allocation lookup.' using errcode = '55000';
  end if;

  patched := replace(definition, old_comparison, new_comparison);
  if patched = definition
    or patched !~ 'order_id::text = new\.order_id::text and quote_id = new\.id' then
    raise exception 'Portable fabric-allocation lookup correction failed validation.' using errcode = '55000';
  end if;

  execute patched;
end;
$migration$;
