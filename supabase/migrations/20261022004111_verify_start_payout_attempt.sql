do $$
begin
  if not has_function_privilege('service_role','public.start_payout_attempt(uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.start_payout_attempt(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.start_payout_attempt(uuid,text)','EXECUTE') then
    raise exception 'Payout attempt allocation must be service-only';
  end if;
end;
$$;
