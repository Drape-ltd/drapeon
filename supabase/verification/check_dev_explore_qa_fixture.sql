-- Read-only check for the two Dev Explore QA sellers. Run only on Drape-DEV.
do $check$
declare
  v_count integer;
begin
  if not public.is_dev_ops_mfa_environment()
     or public.current_ops_environment() <> 'DEVELOPMENT' then
    raise exception 'Refusing QA fixture check outside Drape-DEV';
  end if;

  select count(*) into v_count
  from auth.users a
  join public.users u on u.id = a.id and u.email = a.email
  join public.tailor_profiles p on p.user_id = a.id::text and p.is_test_profile
  join auth.identities i on i.user_id = a.id and i.provider = 'email'
    and i.identity_data->>'email' = a.email
  where (a.id = 'f9380381-0bbe-4e1f-9cd5-6780a6d48e46'
         and a.email = 'delivered@resend.dev')
     or (a.id = '0c145617-f6f1-4024-bdb3-5f2919e36116'
         and a.email = 'delivered+explore-fixture@resend.dev');

  if v_count <> 2 then
    raise exception 'Dev Explore QA Auth/email/profile fixture is incomplete';
  end if;
end $check$;
