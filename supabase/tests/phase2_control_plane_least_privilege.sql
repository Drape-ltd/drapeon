-- Dev/local assertion for the Phase 2 control-plane grant correction.
do $$
declare
  v_table text;
  v_privilege text;
  v_relations text[] := array[
    'public.ops_coverage_calendars',
    'public.ops_queue_policies',
    'public.payment_route_enablement_requests',
    'public.payout_destination_corrections',
    'public.order_payment_exposure_measurements',
    'public.payout_account_movement_summary'
  ];
  v_privileges text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
begin
  foreach v_table in array v_relations loop
    if not has_table_privilege('service_role', v_table, 'SELECT') then
      raise exception 'service_role must retain read access to %', v_table;
    end if;

    foreach v_privilege in array v_privileges loop
      if v_privilege <> 'SELECT' and has_table_privilege('service_role', v_table, v_privilege) then
        raise exception 'service_role must not have % on %', v_privilege, v_table;
      end if;
      if has_table_privilege('anon', v_table, v_privilege)
        or has_table_privilege('authenticated', v_table, v_privilege) then
        raise exception 'publishable roles must not have % on %', v_privilege, v_table;
      end if;
    end loop;
  end loop;

  if not has_function_privilege(
    'service_role',
    'public.ops_submit_payment_route_enablement_approval(uuid,uuid,uuid,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Audited route-approval RPC must remain executable by service_role';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.apply_reviewed_payout_destination_correction(uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Audited destination-correction RPC must remain executable by service_role';
  end if;
end
$$;
