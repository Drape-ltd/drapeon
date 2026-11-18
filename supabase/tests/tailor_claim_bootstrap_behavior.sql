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
