do $$
declare
  v_finalizer text;
  v_bachs_wrapper text;
  v_guard text;
  v_finalizer_proconfig text[];
  v_finalizer_security_definer boolean;
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version='20261028061641'
      and name='phase3_claimed_route_tranche_finalize'
  ) then
    raise exception 'Provider-neutral tranche finalizer migration is missing';
  end if;

  if to_regprocedure('public.finalize_claimed_route_tranche_release(uuid,text,text)') is null
    or to_regprocedure('public.finalize_claimed_bachs_tranche_release(uuid,text,text)') is null
    or to_regprocedure('public.finalize_staged_settlement_escrow_release(text,uuid)') is null then
    raise exception 'A required provider-neutral tranche/escrow routine is missing';
  end if;

  select pg_get_functiondef('public.finalize_claimed_route_tranche_release(uuid,text,text)'::regprocedure),
         p.proconfig,
         p.prosecdef
    into v_finalizer,v_finalizer_proconfig,v_finalizer_security_definer
    from pg_proc p
    where p.oid='public.finalize_claimed_route_tranche_release(uuid,text,text)'::regprocedure;
  if v_finalizer_security_definer
    or not coalesce(v_finalizer_proconfig @> array['search_path=""'],false)
    or position('public.finalize_staged_settlement_escrow_release' in v_finalizer)=0
    or position('update public.orders' in lower(v_finalizer))>0 then
    raise exception 'Route tranche finalizer is not provider-neutral and order-safe';
  end if;

  select pg_get_functiondef('public.finalize_claimed_bachs_tranche_release(uuid,text,text)'::regprocedure)
    into v_bachs_wrapper;
  if position('public.finalize_claimed_route_tranche_release' in v_bachs_wrapper)=0 then
    raise exception 'Bachs compatibility wrapper does not delegate to the shared finalizer';
  end if;

  select pg_get_functiondef('public.guard_terminal_order_update()'::regprocedure)
    into v_guard;
  if position('legacy_escrow_writes' in lower(v_guard))=0
    or position('staged_escrow_writes' in lower(v_guard))=0
    or position('app.reviewed_payout_destination_correction' in lower(v_guard))=0
    or position('to_jsonb(new)-v_destination_keys' in lower(v_guard))=0 then
    raise exception 'Terminal-order guard lost an existing audited write path';
  end if;

  if has_function_privilege('anon','public.finalize_claimed_route_tranche_release(uuid,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.finalize_claimed_route_tranche_release(uuid,text,text)','EXECUTE')
    or not has_function_privilege('service_role','public.finalize_claimed_route_tranche_release(uuid,text,text)','EXECUTE')
    or has_function_privilege('anon','public.finalize_staged_settlement_escrow_release(text,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.finalize_staged_settlement_escrow_release(text,uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.finalize_staged_settlement_escrow_release(text,uuid)','EXECUTE') then
    raise exception 'Financial finalizer grants are not service-role-only';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='payment_internal' and c.relname='staged_escrow_writes'
      and c.relrowsecurity
  ) or not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='payment_internal' and c.relname='legacy_escrow_writes'
      and c.relrowsecurity
  ) then
    raise exception 'Internal escrow marker tables must keep RLS enabled';
  end if;

  if has_table_privilege('anon','payment_internal.staged_escrow_writes','SELECT')
    or has_table_privilege('authenticated','payment_internal.staged_escrow_writes','SELECT')
    or has_table_privilege('service_role','payment_internal.staged_escrow_writes','SELECT')
    or has_table_privilege('anon','payment_internal.legacy_escrow_writes','SELECT')
    or has_table_privilege('authenticated','payment_internal.legacy_escrow_writes','SELECT')
    or has_table_privilege('service_role','payment_internal.legacy_escrow_writes','SELECT') then
    raise exception 'Internal escrow marker tables must not be directly readable';
  end if;
end;
$$;
