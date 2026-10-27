-- Revert only the order-reference cast introduced by
-- 20261027173818_phase2_ops_queue_uuid_text_compat.sql.
do $$
declare
  v_definition text;
  v_reverted text;
begin
  select pg_get_functiondef(
    'public.ops_queue_page(text,text[],text,jsonb)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'Expected public.ops_queue_page(text,text[],text,jsonb) to exist';
  end if;

  v_reverted := replace(v_definition, 'o.id::text=n.order_id::text', 'o.id=n.order_id');

  if v_reverted <> v_definition then
    execute v_reverted;
  elsif strpos(v_definition, 'o.id=n.order_id') > 0 then
    raise notice 'Ops queue order-reference comparison is already at the pre-migration form.';
  else
    raise exception 'Expected Ops queue text-cast comparison was not found for rollback';
  end if;
end;
$$;

do $$
declare
  v_definition text;
  v_reverted text;
begin
  select pg_get_functiondef(
    'public.create_ops_source_case(text,text,text,text,uuid,text,text,uuid)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'Expected public.create_ops_source_case(text,text,text,text,uuid,text,text,uuid) to exist';
  end if;

  v_reverted := replace(
    v_definition,
    'from public.orders where id::text = p_source_id::text for share',
    'from public.orders where id = p_source_id::text for share'
  );

  if v_reverted <> v_definition then
    execute v_reverted;
  elsif strpos(v_definition, 'from public.orders where id = p_source_id::text for share') > 0 then
    raise notice 'Ops source-case order lookup is already at the pre-migration form.';
  else
    raise exception 'Expected Ops source-case text-cast lookup was not found for rollback';
  end if;
end;
$$;
