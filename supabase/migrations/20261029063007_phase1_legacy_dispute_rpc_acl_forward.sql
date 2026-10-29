-- The legacy dispute resolver is SECURITY DEFINER but has no authenticated
-- Ops-principal check and no application caller. Keep it service-role-only.
-- This repair is intentionally forward-only; restoring PUBLIC/client execution
-- would reintroduce an unauthorized dispute/order mutation path.

do $$
declare
  v_signature regprocedure :=
    'public.ops_resolve_dispute(uuid,text,text)'::regprocedure;
  v_security_definer boolean;
begin
  select prosecdef into v_security_definer
  from pg_proc
  where oid = v_signature;

  if v_security_definer is distinct from true then
    raise exception 'Expected legacy dispute resolver SECURITY DEFINER function';
  end if;
end;
$$;

revoke all on function public.ops_resolve_dispute(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.ops_resolve_dispute(uuid,text,text)
  to service_role;

do $$
declare
  v_signature regprocedure :=
    'public.ops_resolve_dispute(uuid,text,text)'::regprocedure;
begin
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute') then
    raise exception 'Legacy dispute resolver ACL is not service-role-only';
  end if;
end;
$$;
