-- Catalog-only contract: provider-neutral text IDs must reference unique
-- generated text keys regardless of the project's native PK type.
do $$
declare
  v_table text;
  v_fk_count integer;
  v_key_count integer;
begin
  foreach v_table in array array['orders', 'tailor_profiles', 'payouts'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_table
        and column_name = 'id_text' and data_type = 'text'
        and is_generated = 'ALWAYS'
    ) then
      raise exception '% is missing its generated text key', v_table;
    end if;
  end loop;

  select count(*) into v_key_count
  from pg_index i
  join pg_class idx on idx.oid = i.indexrelid
  join pg_class tbl on tbl.oid = i.indrelid
  where tbl.relnamespace = 'public'::regnamespace
    and (tbl.relname, idx.relname) in (
      ('orders', 'orders_id_text_uidx'),
      ('tailor_profiles', 'tailor_profiles_id_text_uidx'),
      ('payouts', 'payouts_id_text_key')
    )
    and i.indisunique and i.indisvalid and i.indisready;
  if v_key_count <> 3 then
    raise exception 'Expected three valid unique text-key indexes; found %', v_key_count;
  end if;

  select count(*) into v_fk_count
  from pg_constraint c
  where c.conrelid = 'public.payout_claims'::regclass
    and c.contype = 'f'
    and c.conname in (
      'payout_claims_order_id_text_fkey',
      'payout_claims_tailor_profile_id_text_fkey',
      'payout_claims_payout_id_text_fkey'
    )
    and pg_get_constraintdef(c.oid) like '%(id_text)%';
  if v_fk_count <> 3 then
    raise exception 'Expected three payout-claim foreign keys to generated text IDs; found %', v_fk_count;
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.payout_claims'::regclass) then
    raise exception 'Payout claims RLS is disabled';
  end if;
  if has_table_privilege('anon', 'public.payout_claims', 'select')
    or has_table_privilege('anon', 'public.payout_claims', 'insert')
    or has_table_privilege('anon', 'public.payout_claims', 'update')
    or has_table_privilege('anon', 'public.payout_claims', 'delete')
    or has_table_privilege('anon', 'public.payout_claims', 'truncate')
    or has_table_privilege('anon', 'public.payout_claims', 'references')
    or has_table_privilege('anon', 'public.payout_claims', 'trigger')
    or has_table_privilege('authenticated', 'public.payout_claims', 'select')
    or has_table_privilege('authenticated', 'public.payout_claims', 'insert')
    or has_table_privilege('authenticated', 'public.payout_claims', 'update')
    or has_table_privilege('authenticated', 'public.payout_claims', 'delete')
    or has_table_privilege('authenticated', 'public.payout_claims', 'truncate')
    or has_table_privilege('authenticated', 'public.payout_claims', 'references')
    or has_table_privilege('authenticated', 'public.payout_claims', 'trigger') then
    raise exception 'Client roles have direct privileges on payout claims';
  end if;
  if not has_table_privilege('service_role', 'public.payout_claims', 'select')
    or not has_table_privilege('service_role', 'public.payout_claims', 'insert')
    or not has_table_privilege('service_role', 'public.payout_claims', 'update')
    or has_table_privilege('service_role', 'public.payout_claims', 'delete')
    or has_table_privilege('service_role', 'public.payout_claims', 'truncate')
    or has_table_privilege('service_role', 'public.payout_claims', 'references')
    or has_table_privilege('service_role', 'public.payout_claims', 'trigger') then
    raise exception 'Payout claim table privileges exceed the service-only contract';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.payout_claims'::regclass
      and tgname = 'payout_claim_identity_immutable'
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'Payout claim identity trigger is missing or disabled';
  end if;
end;
$$;
