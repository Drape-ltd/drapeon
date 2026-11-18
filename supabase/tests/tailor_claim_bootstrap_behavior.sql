begin;

set local role postgres;
insert into auth.users(id, email) values
  ('11000000-0000-0000-0000-000000000001', 'draft+11000000-0000-0000-0000-000000000001@claim.drapeon.invalid');
insert into public.users(id, email) values
  ('11000000-0000-0000-0000-000000000001', 'draft+11000000-0000-0000-0000-000000000001@claim.drapeon.invalid');
insert into public.tailor_profiles(id, user_id) values
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001');
insert into public.customer_records(id, owner_id) values
  ('31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001');
insert into storage.objects(id, owner_id) values
  ('41000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001');
insert into public.tailor_claim_invites(id, tailor_user_id, token_hash, status, expires_at) values
  ('51000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', repeat('b', 43), 'OPENED', now() + interval '1 day');
insert into public.tailor_claim_email_paths(invite_id) values
  ('51000000-0000-0000-0000-000000000001');
insert into public.tailor_claim_email_codes(id, invite_id, email_hash, code_hash, status, expires_at, verified_at) values
  ('61000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', repeat('f', 43), repeat('d', 43), 'VERIFIED', now() + interval '5 minutes', now());

do $$
declare prepared record;
begin
  select * into prepared from public.prepare_tailor_claim_bootstrap_session(
    repeat('b', 43), repeat('f', 43), repeat('d', 43), '71000000-0000-0000-0000-000000000001');
  if prepared.result <> 'PREPARED' or prepared.user_id <> '11000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'bootstrap prepare failed: %', row_to_json(prepared);
  end if;
  if not public.activate_tailor_claim_bootstrap_session(
    '71000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001') then
    raise exception 'bootstrap activation failed';
  end if;
end
$$;

insert into auth.users(id, email) values
  ('11000000-0000-0000-0000-000000000002', 'draft+11000000-0000-0000-0000-000000000002@claim.drapeon.invalid');
insert into public.tailor_claim_invites(id, tailor_user_id, token_hash, status, expires_at) values
  ('51000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', repeat('c', 43), 'OPENED', now() + interval '1 day');
do $$
declare prepared record;
begin
  select * into prepared from public.prepare_tailor_claim_provider_proof(
    repeat('c', 43), 'google', repeat('a', 64), '71000000-0000-0000-0000-000000000002');
  if prepared.result <> 'PROOF_REQUIRED' or prepared.user_id <> '11000000-0000-0000-0000-000000000002'::uuid then
    raise exception 'provider proof prepare failed: %', row_to_json(prepared);
  end if;
end
$$;

insert into auth.users(id, email) values
  ('11000000-0000-0000-0000-000000000003', 'provider-existing@example.com');
insert into auth.identities(id, user_id, provider_id, identity_data, provider) values
  ('google-subject-conflict', '11000000-0000-0000-0000-000000000003', 'google-subject-conflict', '{"sub":"google-subject-conflict"}', 'google');

do $$
declare recorded record; prepared record;
begin
  select * into recorded from public.record_tailor_claim_provider_proof(
    '71000000-0000-0000-0000-000000000002', 'google', 'google-subject-conflict');
  if recorded.result <> 'ACCOUNT_CONFLICT' then
    raise exception 'provider collision was not rejected: %', row_to_json(recorded);
  end if;
  if not exists (
    select 1 from public.audit_logs
    where event = 'tailor_claim.provider_account_conflict'
      and payload->>'claim_session_id' = '71000000-0000-0000-0000-000000000002'
  ) then raise exception 'provider collision audit was not recorded'; end if;

  select * into prepared from public.prepare_tailor_claim_provider_proof(
    repeat('c', 43), 'google', repeat('e', 64), '71000000-0000-0000-0000-000000000003');
  if prepared.superseded_sessions <> 0 then raise exception 'failed proof should not count as active'; end if;
  select * into recorded from public.record_tailor_claim_provider_proof(
    '71000000-0000-0000-0000-000000000003', 'google', 'google-subject-clean');
  if recorded.result <> 'VERIFIED' then raise exception 'clean provider proof failed: %', row_to_json(recorded); end if;
  if not public.activate_tailor_claim_bootstrap_session(
    '71000000-0000-0000-0000-000000000003',
    '81000000-0000-0000-0000-000000000003',
    '11000000-0000-0000-0000-000000000002') then
    raise exception 'verified provider proof could not activate';
  end if;

  select * into prepared from public.prepare_tailor_claim_provider_proof(
    repeat('c', 43), 'google', repeat('f', 64), '71000000-0000-0000-0000-000000000004');
  if prepared.superseded_sessions <> 1 then raise exception 'stuck bootstrap was not superseded'; end if;
  if not exists (
    select 1 from public.audit_logs
    where event = 'tailor_claim.bootstrap_session_superseded'
      and payload->>'claim_session_id' = '71000000-0000-0000-0000-000000000003'
  ) then raise exception 'superseded bootstrap audit was not recorded'; end if;

  select * into recorded from public.record_tailor_claim_provider_proof(
    '71000000-0000-0000-0000-000000000004', 'google', 'google-subject-clean');
  if recorded.result <> 'VERIFIED' then
    raise exception 'same provider subject could not retry after supersede: %', row_to_json(recorded);
  end if;
  if not public.fail_tailor_claim_provider_bootstrap_session(
    '71000000-0000-0000-0000-000000000004', 'TEST_RETRY') then
    raise exception 'verified retry fixture could not be failed';
  end if;
  select * into prepared from public.prepare_tailor_claim_provider_proof(
    repeat('c', 43), 'google', repeat('9', 64), '71000000-0000-0000-0000-000000000005');
  select * into recorded from public.record_tailor_claim_provider_proof(
    '71000000-0000-0000-0000-000000000005', 'google', 'google-subject-clean');
  if recorded.result <> 'VERIFIED' then
    raise exception 'same provider subject could not retry after failure: %', row_to_json(recorded);
  end if;
end
$$;

set local request.jwt.claims = '{"sub":"11000000-0000-0000-0000-000000000001","session_id":"81000000-0000-0000-0000-000000000001","app_metadata":{"account_origin":"STAFF_DRAFT","claim_session_id":"71000000-0000-0000-0000-000000000001"}}';
set local role authenticated;

do $$
begin
  if not public.is_staff_draft_identity() then raise exception 'draft identity helper failed'; end if;
  if not public.is_active_tailor_claim_bootstrap_session() then raise exception 'active bootstrap helper failed'; end if;
  if exists(select 1 from public.customer_records) then raise exception 'customer RLS leak'; end if;
  if exists(select 1 from public.tailor_profiles) then raise exception 'tailor RLS leak'; end if;
  if exists(select 1 from storage.objects) then raise exception 'storage RLS leak'; end if;
end
$$;

reset role;
select 'tailor_claim_bootstrap_fresh_postgres_passed';
rollback;
