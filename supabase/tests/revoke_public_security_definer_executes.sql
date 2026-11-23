-- Run after 20261123162913_revoke_public_security_definer_executes.sql.
-- These SECURITY DEFINER mutation helpers are Edge/Ops internals, never client RPCs.
do $$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.finalize_order_terminal(uuid,text,text,text,text,text,jsonb,text[],text,boolean,boolean,boolean,boolean)'::regprocedure,
    'public.reserve_seller_item_inventory(uuid,integer)'::regprocedure,
    'public.reserve_seller_item_inventory(uuid,integer,text)'::regprocedure,
    'public.release_seller_item_inventory(uuid,integer)'::regprocedure,
    'public.release_seller_item_inventory(uuid,integer,text)'::regprocedure
  ] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
      or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'Client role retains EXECUTE on %', v_fn;
    end if;

    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'Service role lost required EXECUTE on %', v_fn;
    end if;

    if exists (
      select 1
      from pg_proc p,
        lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_fn
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'PUBLIC retains EXECUTE on %', v_fn;
    end if;
  end loop;
end;
$$;
