\set ON_ERROR_STOP on

begin;

do $$
declare
  v_missing text;
begin
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ' order by n.nspname, c.relname)
    into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and c.relrowsecurity
    and n.nspname = 'public'
    and not exists (
      select 1 from pg_policy p
      where p.polrelid = c.oid
        and p.polname = 'deny_staff_draft_claim_session'
    );
  if v_missing is not null then
    raise exception 'RLS deny policy missing from: %', v_missing;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'deny_staff_draft_claim_session'
      and permissive = 'RESTRICTIVE'
  ) then
    raise exception 'Realtime STAFF_DRAFT deny policy is missing';
  end if;
end
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"12000000-0000-0000-0000-000000000001","app_metadata":{"role":"TAILOR","account_origin":"STAFF_DRAFT"}}',
  true
);
do $$
begin
  perform public.reject_staff_draft_data_api_request();
  raise exception 'STAFF_DRAFT request unexpectedly passed the pre-request hook';
exception
  when insufficient_privilege then
    if sqlerrm <> 'STAFF_DRAFT_SESSION_DENIED' then raise; end if;
end
$$;
reset role;

insert into auth.users(id, email, raw_app_meta_data)
values (
  '12000000-0000-0000-0000-000000000001',
  'draft+boundary@claim.drapeon.invalid',
  '{"role":"TAILOR","account_origin":"STAFF_DRAFT","claim_session_id":"12000000-0000-0000-0000-000000000004"}'
);
insert into public.tailor_claim_invites(id, tailor_user_id, token_hash, status, expires_at)
values (
  '12000000-0000-0000-0000-000000000002',
  '12000000-0000-0000-0000-000000000001',
  repeat('b', 43),
  'OPENED',
  now() + interval '1 hour'
);
insert into public.tailor_claim_bootstrap_sessions(
  id, invite_id, user_id, status, auth_session_id, expires_at, activated_at, created_at
) values (
  '12000000-0000-0000-0000-000000000004',
  '12000000-0000-0000-0000-000000000002',
  '12000000-0000-0000-0000-000000000001',
  'ACTIVE',
  '12000000-0000-0000-0000-000000000003',
  now() - interval '1 minute',
  now() - interval '11 minutes',
  now() - interval '11 minutes'
);
insert into auth.sessions(id, user_id)
values ('12000000-0000-0000-0000-000000000003', '12000000-0000-0000-0000-000000000001');

do $$
declare
  v_result record;
begin
  select * into v_result
  from public.reap_expired_tailor_claim_bootstrap_sessions(1);
  if v_result.bootstrap_session_id <> '12000000-0000-0000-0000-000000000004'::uuid
     or v_result.auth_sessions_revoked <> 1 then
    raise exception 'Expired bootstrap fixture was not reaped: %', row_to_json(v_result);
  end if;
  if not exists (
    select 1 from auth.users
    where id = '12000000-0000-0000-0000-000000000001'
      and banned_until > now() + interval '99 years'
      and raw_app_meta_data ->> 'account_origin' = 'STAFF_DRAFT'
      and not raw_app_meta_data ? 'claim_session_id'
  ) then
    raise exception 'Expired placeholder was not re-banned';
  end if;
  if exists (
    select 1 from auth.sessions
    where user_id = '12000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'Expired placeholder Auth session was not revoked';
  end if;
  if not exists (
    select 1 from public.tailor_claim_bootstrap_sessions
    where id = '12000000-0000-0000-0000-000000000004'
      and status = 'EXPIRED'
      and completed_at is not null
  ) then
    raise exception 'Expired bootstrap ledger row was not completed';
  end if;
end
$$;

rollback;
select 'tailor_claim_request_boundary_fresh_postgres_passed' as result;
