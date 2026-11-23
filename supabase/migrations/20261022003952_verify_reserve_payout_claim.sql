do $$
begin
  if not has_function_privilege('service_role',
    'public.reserve_payout_claim(text,text,text,text,text,text,text,public.currency,integer,text,text,text,text)',
    'EXECUTE')
    or has_function_privilege('anon',
    'public.reserve_payout_claim(text,text,text,text,text,text,text,public.currency,integer,text,text,text,text)',
    'EXECUTE')
    or has_function_privilege('authenticated',
    'public.reserve_payout_claim(text,text,text,text,text,text,text,public.currency,integer,text,text,text,text)',
    'EXECUTE') then
    raise exception 'Payout claim reservation permissions are unsafe';
  end if;
end;
$$;
