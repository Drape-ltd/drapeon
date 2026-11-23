-- Restore the prior lookup expression without changing any accepted quote or
-- allocation data.
do $rollback$
declare
  target_function regprocedure := to_regprocedure(
    'public.lock_fabric_allocation_on_quote_acceptance()'
  );
  allocation_order_id_type oid;
  quote_order_id_type oid;
  definition text;
  patched text;
  new_comparison constant text := 'where order_id::text = new.order_id::text and quote_id = new.id';
  old_comparison constant text := 'where order_id = new.order_id and quote_id = new.id';
begin
  if target_function is null then
    raise exception 'Funded-fabric quote acceptance trigger is unavailable.' using errcode = '55000';
  end if;

  select a.atttypid into allocation_order_id_type
  from pg_attribute a
  where a.attrelid = 'public.order_fabric_funding_allocations'::regclass
    and a.attname = 'order_id'
    and a.attnum > 0
    and not a.attisdropped;

  select a.atttypid into quote_order_id_type
  from pg_attribute a
  where a.attrelid = 'public.order_quotes'::regclass
    and a.attname = 'order_id'
    and a.attnum > 0
    and not a.attisdropped;

  if allocation_order_id_type is null or quote_order_id_type is null then
    raise exception 'Cannot safely restore the prior fabric-allocation lookup because an order_id column is unavailable.' using errcode = '55000';
  end if;

  if allocation_order_id_type <> quote_order_id_type then
    raise exception 'Cannot safely restore direct order_id equality while fabric allocation and quote order_id types differ; keep the portable lookup and ship a reviewed forward correction.' using errcode = '55000';
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
