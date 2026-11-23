-- Keep this verifier separate from the function replacement so an incomplete
-- deployment fails before payout workers rely on the anomaly guard.
do $$
declare
  v_function oid;
  v_source text;
begin
  v_function := to_regprocedure(
    'public.block_confirmed_payout_identity_conflict(uuid,jsonb)');
  if v_function is null then
    raise exception 'Confirmed-payout identity blocker is missing';
  end if;
  select prosrc into v_source from pg_proc where oid=v_function;
  if v_source not like '%successful_attempt_matches_transfer%'
    or v_source not like '%status not in (''TRANSFERRED'',''WITHDRAWN'')%'
    or v_source not like '%provider_transfer_id%' then
    raise exception 'Confirmed-payout anomaly guard is not installed';
  end if;
  if not has_function_privilege('service_role',v_function,'EXECUTE')
    or has_function_privilege('authenticated',v_function,'EXECUTE')
    or has_function_privilege('anon',v_function,'EXECUTE') then
    raise exception 'Confirmed-payout blocker privileges are unsafe';
  end if;
end $$;
