-- Manual Drape-DEV QA fixture repair. Never add this to a migration batch.
-- The normal Auth Admin API should update the reference seller first:
-- f9380381-0bbe-4e1f-9cd5-6780a6d48e46 -> delivered@resend.dev.
-- This file repairs the older synthetic Auth row that the Admin API cannot find.
-- It does not create a password or grant an Ops role.
begin;

do $repair$
declare
  v_id uuid := '0c145617-f6f1-4024-bdb3-5f2919e36116';
  v_email text := 'delivered+explore-fixture@resend.dev';
  v_old_email text := 'exception-0c145617-f6f1-4024-bdb3-5f2919e36116@drapeon.invalid';
  v_current_email text;
begin
  if not public.is_dev_ops_mfa_environment()
     or public.current_ops_environment() <> 'DEVELOPMENT' then
    raise exception 'Refusing QA Auth repair outside Drape-DEV';
  end if;

  select email into v_current_email from auth.users where id = v_id for update;
  if v_current_email is null or v_current_email not in (v_old_email, v_email) then
    raise exception 'Unexpected QA Auth user state';
  end if;
  if not exists (
    select 1 from public.tailor_profiles
    where user_id = v_id::text and is_test_profile and marketplace_category = 'TAILORING'
  ) then
    raise exception 'Expected Dev-only QA tailor profile is missing';
  end if;
  if exists (select 1 from auth.users where email = v_email and id <> v_id) then
    raise exception 'QA recipient is already assigned to another Auth user';
  end if;

  update auth.users
  set email = v_email,
      instance_id = '00000000-0000-0000-0000-000000000000',
      aud = 'authenticated',
      role = 'authenticated',
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      created_at = coalesce(created_at, now()),
      encrypted_password = coalesce(encrypted_password, ''),
      confirmation_token = coalesce(confirmation_token, ''),
      recovery_token = coalesce(recovery_token, ''),
      email_change = coalesce(email_change, ''),
      email_change_token_new = coalesce(email_change_token_new, ''),
      raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
      updated_at = now()
  where id = v_id;

  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now())
  on conflict (provider_id, provider) do update set
    identity_data = excluded.identity_data,
    updated_at = now();

  if not exists (select 1 from public.users where id = v_id and email = v_email) then
    raise exception 'Public QA user email did not follow Auth email';
  end if;
end $repair$;

commit;
