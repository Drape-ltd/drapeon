do $$
declare
  v_signature constant text := 'public.record_bachs_provider_dispute_event(text,text,text,uuid,text,uuid,uuid,integer,public.currency,text,text,timestamptz,text,text,timestamptz,text,jsonb)';
  v_definition text;
  v_config text[];
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version='20261028062947'
      and name='bachs_provider_dispute_lifecycle'
  ) then
    raise exception 'Bachs dispute lifecycle migration is missing from Dev history';
  end if;

  if to_regprocedure(v_signature) is null then
    raise exception 'Bachs provider dispute lifecycle RPC is missing';
  end if;

  select pg_get_functiondef(v_signature::regprocedure), p.proconfig
    into v_definition, v_config
    from pg_proc p where p.oid=v_signature::regprocedure;

  if position('security definer' in lower(v_definition))=0
    or not coalesce(v_config @> array['search_path=""'],false)
    or position('for update' in lower(v_definition))=0
    or position('p_provider_updated_at < v_previous_at' in v_definition)=0
    or position('chronology_conflict' in v_definition)=0
    or position('identity_conflict' in v_definition)=0 then
    raise exception 'Dispute RPC is missing its lock, chronology, identity, or search-path guard';
  end if;

  if has_function_privilege('anon',v_signature,'EXECUTE')
    or has_function_privilege('authenticated',v_signature,'EXECUTE')
    or not has_function_privilege('service_role',v_signature,'EXECUTE') then
    raise exception 'Dispute RPC must be executable only by service_role';
  end if;

  if (select count(*) from public.payment_routes) <> 0 then
    raise exception 'Phase 3 Dev verification expected no payment routes';
  end if;
end;
$$;
