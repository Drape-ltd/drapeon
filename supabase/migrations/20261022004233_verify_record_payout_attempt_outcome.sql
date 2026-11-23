do $$
begin
  if not has_function_privilege('service_role',
    'public.record_payout_attempt_outcome(uuid,text,text,jsonb)','EXECUTE')
    or has_function_privilege('anon',
    'public.record_payout_attempt_outcome(uuid,text,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated',
    'public.record_payout_attempt_outcome(uuid,text,text,jsonb)','EXECUTE') then
    raise exception 'Payout outcome recording must be service-only';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
    and tablename='payout_claims' and indexname='payout_claims_provider_transfer_unique_idx'
    and indexdef like '%UNIQUE INDEX%') then
    raise exception 'Provider transfer reference must be unique';
  end if;
end;
$$;
