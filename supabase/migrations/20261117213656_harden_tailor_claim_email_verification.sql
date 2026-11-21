create or replace function public.verify_tailor_claim_email_code(
  p_token_hash text,
  p_email text,
  p_email_hash text,
  p_code_hash text
) returns table(result text, invite_id uuid)
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_path public.tailor_claim_email_paths%rowtype;
  v_code public.tailor_claim_email_codes%rowtype;
begin
  if length(coalesce(p_email, '')) > 320
     or p_email is null
     or p_email <> lower(btrim(p_email)) then
    result := 'INVALID_CODE'; return next; return;
  end if;

  select * into v_invite
  from public.tailor_claim_invites
  where token_hash = p_token_hash
  for update;
  if not found or v_invite.status not in ('INVITED', 'OPENED')
     or v_invite.expires_at is null or v_invite.expires_at <= now() then
    result := 'UNAVAILABLE'; return next; return;
  end if;

  select * into v_path
  from public.tailor_claim_email_paths
  where public.tailor_claim_email_paths.invite_id = v_invite.id
  for update;
  if found and v_path.locked_at is not null then
    result := 'EMAIL_LOCKED'; invite_id := v_invite.id; return next; return;
  end if;

  select * into v_code
  from public.tailor_claim_email_codes
  where public.tailor_claim_email_codes.invite_id = v_invite.id
    and email_hash = p_email_hash and status = 'PENDING'
  order by created_at desc limit 1 for update;
  if not found then result := 'INVALID_CODE'; invite_id := v_invite.id; return next; return; end if;
  if v_code.expires_at <= now() then
    update public.tailor_claim_email_codes
      set status = 'EXPIRED', updated_at = now()
    where id = v_code.id;
    result := 'CODE_EXPIRED'; invite_id := v_invite.id; return next; return;
  end if;

  if v_code.code_hash <> p_code_hash then
    return query
      select checked.result, checked.invite_id
      from public.verify_tailor_claim_email_code(p_token_hash, p_email_hash, p_code_hash) checked;
    return;
  end if;

  -- Collision is deliberately last: invalid, revoked, expired, or locked
  -- capabilities must never reveal account existence.
  if exists (
    select 1 from auth.users au
    where au.email = p_email and au.id <> v_invite.tailor_user_id
  ) or exists (
    select 1 from public.users pu
    where pu.email = p_email and pu.id <> v_invite.tailor_user_id
  ) then
    result := 'ACCOUNT_CONFLICT'; invite_id := v_invite.id; return next; return;
  end if;

  update public.tailor_claim_email_codes
    set status = 'VERIFIED', verified_at = now(), updated_at = now()
  where id = v_code.id;
  result := 'VERIFIED'; invite_id := v_invite.id; return next;
end;
$$;

revoke all on function public.verify_tailor_claim_email_code(text, text, text, text) from public, anon, authenticated;
grant execute on function public.verify_tailor_claim_email_code(text, text, text, text) to service_role;

comment on function public.verify_tailor_claim_email_code(text, text, text, text) is
  'Applies invite, lock, and expiry gates before checking account collision and verifying a claim-owned email code.';
