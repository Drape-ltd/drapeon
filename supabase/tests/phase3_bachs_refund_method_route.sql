do $$
declare
  v_default text;
  v_constraint text;
  v_guard_signature constant text := 'private.guard_payment_route_methods_immutable()';
  v_default_signature constant text := 'private.default_bachs_refundable_methods()';
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version='20261028063130'
      and name='bachs_refund_payment_method_routes'
  ) then
    raise exception 'Bachs refund-method migration is missing from Dev history';
  end if;

  select column_default into v_default
    from information_schema.columns
    where table_schema='public' and table_name='payment_routes'
      and column_name='payment_method_types' and is_nullable='NO';
  if v_default is null or (position('{}' in v_default)=0
    and position('ARRAY[]' in upper(v_default))=0) then
    raise exception 'Payment route collection methods must be non-null and default empty';
  end if;

  select pg_get_constraintdef(oid) into v_constraint
    from pg_constraint
    where conrelid='public.payment_routes'::regclass
      and conname='payment_routes_bachs_refundable_methods_check';
  if v_constraint is null or position('NGN_CARD' in v_constraint)=0
    or position('BACHS' in v_constraint)=0 then
    raise exception 'Bachs route constraint must allow only the refund-capable card corridor';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid='public.payment_routes'::regclass
      and tgname='payment_routes_default_bachs_refundable_methods' and tgenabled='O')
    or not exists (select 1 from pg_trigger where tgrelid='public.payment_routes'::regclass
      and tgname='payment_routes_methods_immutable' and tgenabled='O') then
    raise exception 'Bachs method default and immutable-version triggers must be enabled';
  end if;

  if has_function_privilege('anon',v_guard_signature,'EXECUTE')
    or has_function_privilege('authenticated',v_guard_signature,'EXECUTE')
    or has_function_privilege('anon',v_default_signature,'EXECUTE')
    or has_function_privilege('authenticated',v_default_signature,'EXECUTE') then
    raise exception 'Private route triggers must not be directly executable by clients';
  end if;

  if (select count(*) from public.payment_routes) <> 0 then
    raise exception 'Phase 3 Dev verification expected no payment routes';
  end if;
end;
$$;
