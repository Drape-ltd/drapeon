-- Forward-only PAY-003 privilege repair. Supabase's default table privileges
-- gave service_role ALL when the three tables were created. The grants in
-- 20261118222734 did not remove DELETE/TRUNCATE/REFERENCES/TRIGGER.
-- Keep the service write surface to the operations each table actually uses.

do $guard$
declare
  v_table text;
begin
  foreach v_table in array array[
    'payment_status_transition_audits',
    'order_payment_provider_refunds',
    'payment_late_success_refund_operations'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'PAY003_GRANT_REPAIR_TABLE_MISSING:%', v_table;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_table
        and c.relkind='r' and c.relrowsecurity
    ) then
      raise exception 'PAY003_GRANT_REPAIR_RLS_MISSING:%', v_table;
    end if;
    if has_table_privilege('anon','public.' || v_table,'SELECT')
       or has_table_privilege('authenticated','public.' || v_table,'SELECT') then
      raise exception 'PAY003_GRANT_REPAIR_CLIENT_READ_DRIFT:%', v_table;
    end if;
  end loop;
end;
$guard$;

revoke all on table public.payment_status_transition_audits from service_role;
grant select, insert on table public.payment_status_transition_audits to service_role;

revoke all on table public.order_payment_provider_refunds from service_role;
grant select, insert, update on table public.order_payment_provider_refunds to service_role;

revoke all on table public.payment_late_success_refund_operations from service_role;
grant select, insert, update on table public.payment_late_success_refund_operations to service_role;

do $verify$
declare
  v_table text;
begin
  foreach v_table in array array[
    'payment_status_transition_audits',
    'order_payment_provider_refunds',
    'payment_late_success_refund_operations'
  ] loop
    if not has_table_privilege('service_role','public.' || v_table,'SELECT')
       or not has_table_privilege('service_role','public.' || v_table,'INSERT')
       or has_table_privilege('service_role','public.' || v_table,'DELETE')
       or has_table_privilege('service_role','public.' || v_table,'TRUNCATE')
       or has_table_privilege('service_role','public.' || v_table,'REFERENCES')
       or has_table_privilege('service_role','public.' || v_table,'TRIGGER')
       or (v_table='payment_status_transition_audits'
           and has_table_privilege('service_role','public.' || v_table,'UPDATE'))
       or (v_table<>'payment_status_transition_audits'
           and not has_table_privilege('service_role','public.' || v_table,'UPDATE')) then
      raise exception 'PAY003_GRANT_REPAIR_POSTCHECK_FAILED:%', v_table;
    end if;
  end loop;
end;
$verify$;
