-- Preserve the later Phase 2 Ops compatibility fixes after historical forward repair.
-- Keep the Ops queue's optional order-reference search portable across the
-- UUID and text order-id schemas used by historical environments.
do $$
declare
  v_definition text;
  v_repaired text;
begin
  select pg_get_functiondef(
    'public.ops_queue_page(text,text[],text,jsonb)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'Expected public.ops_queue_page(text,text[],text,jsonb) to exist';
  end if;

  v_repaired := replace(v_definition, 'o.id=n.order_id', 'o.id::text=n.order_id::text');

  if v_repaired <> v_definition then
    execute v_repaired;
  elsif strpos(v_definition, 'o.id::text=n.order_id::text') > 0 then
    raise notice 'Ops queue order-reference comparison is already text-compatible.';
  else
    raise exception 'Expected Ops queue order-reference comparison was not found';
  end if;
end;
$$;

-- The Ops source-case RPC accepts the order identifier as text. Cast the
-- database identifier too so the same RPC works with UUID- and text-key schemas.
do $$
declare
  v_definition text;
  v_repaired text;
begin
  select pg_get_functiondef(
    'public.create_ops_source_case(text,text,text,text,uuid,text,text,uuid)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'Expected public.create_ops_source_case(text,text,text,text,uuid,text,text,uuid) to exist';
  end if;

  v_repaired := replace(
    v_definition,
    'from public.orders where id = p_source_id::text for share',
    'from public.orders where id::text = p_source_id::text for share'
  );

  if v_repaired <> v_definition then
    execute v_repaired;
  elsif strpos(v_definition, 'from public.orders where id::text = p_source_id::text for share') > 0 then
    raise notice 'Ops source-case order lookup is already text-compatible.';
  else
    raise exception 'Expected Ops source-case order lookup was not found';
  end if;
end;
$$;

-- A null reminderMode is an actionable escalation, not a digest-only one.
-- Coalesce explicitly so SQL's UNKNOWN result cannot suppress the audit trigger.
create or replace trigger trg_enqueue_ops_slack_audit_event
after insert on public.ops_audit_logs
for each row
when (
  new.action_taken not in ('CASE_ADD_NOTE', 'CASE_ASSIGN_SELF', 'CASE_ACKNOWLEDGE')
  and not (
    new.action_taken = 'ISSUE_ESCALATED'
    and new.performed_role = 'SYSTEM'
    and coalesce(new.after_state ->> 'reminderMode', '') = 'DAILY_DIGEST'
  )
)
execute function public.enqueue_ops_slack_audit_event();
