-- Phase 3 tables must remain reachable by the service-role Data API after
-- Supabase's default grants for newly created public objects are removed.
-- Sensitive payment/control tables must not be reachable by client roles.
do $$
declare
  v_table text;
  v_service_write boolean;
  v_privilege text;
begin
  for v_table, v_service_write in
    select * from (values
      ('payout_claims', true),
      ('payout_attempts', true),
      ('order_payment_refund_claims', true),
      ('payout_provider_operations', true),
      ('bachs_account_setup_claims', true),
      ('order_payment_refund_attempts', true),
      ('provider_payment_settlement_checks', false)
    ) as expected(table_name, service_write)
  loop
    if not has_table_privilege('service_role', format('public.%I', v_table), 'SELECT') then
      raise exception 'service_role is missing SELECT on public.%', v_table;
    end if;
    if has_table_privilege('service_role', format('public.%I', v_table), 'INSERT') is distinct from v_service_write
      or has_table_privilege('service_role', format('public.%I', v_table), 'UPDATE') is distinct from v_service_write then
      raise exception 'service_role write grants are incorrect on public.%', v_table;
    end if;
    if has_table_privilege('service_role', format('public.%I', v_table), 'DELETE')
      or has_table_privilege('service_role', format('public.%I', v_table), 'TRUNCATE') then
      raise exception 'service_role has unexpected destructive grants on public.%', v_table;
    end if;

    foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    loop
      if has_table_privilege('anon', format('public.%I', v_table), v_privilege)
        or has_table_privilege('authenticated', format('public.%I', v_table), v_privilege) then
        raise exception 'Client role has % on private Phase 3 table public.%', v_privilege, v_table;
      end if;
    end loop;
  end loop;
end;
$$;
