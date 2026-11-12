-- The Edge Function calls this RPC with the service-role client. The function
-- must own its narrow table access instead of requiring broad table grants on
-- payment route and payout authorization data.
do $$
declare
  v_security_definer boolean;
  v_config text[];
begin
  select p.prosecdef, p.proconfig
  into v_security_definer, v_config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid = 'public.snapshot_ready_made_payment_route(text,uuid,uuid,integer,uuid,integer,uuid,text,text)'::regprocedure;

  if v_security_definer is distinct from true then
    raise exception 'snapshot_ready_made_payment_route must be SECURITY DEFINER for service_role execution';
  end if;

  if not coalesce(v_config, array[]::text[]) @> array['search_path=""']::text[] then
    raise exception 'snapshot_ready_made_payment_route must use an empty search_path';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.snapshot_ready_made_payment_route(text,uuid,uuid,integer,uuid,integer,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'service_role must retain execute access to snapshot_ready_made_payment_route';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.snapshot_ready_made_payment_route(text,uuid,uuid,integer,uuid,integer,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated users must not call snapshot_ready_made_payment_route directly';
  end if;
end;
$$;

