do $$
declare
  v_fn regprocedure := to_regprocedure('public.prevent_settlement_evidence_mutation()');
  v_proconfig text[];
  v_security_definer boolean;
  v_enabled_trigger_count integer;
begin
  if v_fn is null then
    raise exception 'Append-only settlement trigger function is missing';
  end if;

  if has_function_privilege('anon', v_fn, 'EXECUTE')
    or has_function_privilege('authenticated', v_fn, 'EXECUTE')
    or has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'Trigger-only settlement guard remains directly executable';
  end if;

  select proconfig, prosecdef into v_proconfig, v_security_definer
  from pg_proc where oid = v_fn;
  if v_security_definer or not coalesce(v_proconfig @> array['search_path=""'], false) then
    raise exception 'Settlement trigger must remain invoker-safe with an empty search_path';
  end if;

  if exists (
    select 1
    from pg_proc p,
      lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = v_fn
      and a.grantee = 0
      and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Trigger-only settlement guard retains PUBLIC EXECUTE';
  end if;

  select count(*) into v_enabled_trigger_count
  from pg_trigger
  where tgfoid = v_fn
    and tgrelid in (
      'public.order_settlement_evidence'::regclass,
      'public.order_settlement_events'::regclass
    )
    and not tgisinternal
    and tgenabled = 'O';

  if v_enabled_trigger_count <> 2 then
    raise exception 'Expected both append-only settlement triggers to remain enabled';
  end if;
end;
$$;
