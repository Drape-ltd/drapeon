create or replace function public.verify_tailor_claim_email_code(
  p_token_hash text,
  p_email text,
  p_email_hash text,
  p_code_hash text
) returns table(result text, invite_id uuid)
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
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

  if found then
    select * into v_code
    from public.tailor_claim_email_codes
    where public.tailor_claim_email_codes.invite_id = v_invite.id
      and email_hash = p_email_hash
      and status = 'PENDING'
    order by created_at desc
    limit 1
    for update;
  end if;

  -- Only a holder of the current valid code receives a conflict result. This
  -- avoids turning the public action into an account-enumeration endpoint.
  if found and v_code.code_hash = p_code_hash and (
    exists (
      select 1 from auth.users au
      where lower(au.email) = p_email and au.id <> v_invite.tailor_user_id
    ) or exists (
      select 1 from public.users pu
      where lower(pu.email) = p_email and pu.id <> v_invite.tailor_user_id
    )
  ) then
    result := 'ACCOUNT_CONFLICT'; invite_id := v_invite.id; return next; return;
  end if;

  return query
    select verified.result, verified.invite_id
    from public.verify_tailor_claim_email_code(p_token_hash, p_email_hash, p_code_hash) verified;
end;
$$;

revoke all on function public.verify_tailor_claim_email_code(text, text, text, text) from public, anon, authenticated;
grant execute on function public.verify_tailor_claim_email_code(text, text, text, text) to service_role;
revoke all on function public.verify_tailor_claim_email_code(text, text, text) from service_role;

comment on function public.verify_tailor_claim_email_code(text, text, text, text) is
  'Verifies a claim-owned email code and rejects an existing non-placeholder account before any account mutation.';
