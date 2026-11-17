-- The RETURNS TABLE output name invite_id is also a PL/pgSQL variable. Refer
-- to the primary-key constraint explicitly so ON CONFLICT cannot bind to it.
create or replace function public.issue_tailor_claim_email_code(
  p_token_hash text,
  p_email_hash text,
  p_code_hash text
) returns table(result text, invite_id uuid, code_id uuid, job_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite public.tailor_claim_invites%rowtype;
  v_path public.tailor_claim_email_paths%rowtype;
  v_code_id uuid;
  v_job_id uuid;
  v_hour_count bigint;
  v_day_count bigint;
begin
  if length(coalesce(p_token_hash, '')) <> 43
     or length(coalesce(p_email_hash, '')) <> 43
     or length(coalesce(p_code_hash, '')) <> 43 then
    result := 'UNAVAILABLE'; return next; return;
  end if;

  select * into v_invite
  from public.tailor_claim_invites
  where token_hash = p_token_hash
  for update;

  if not found or v_invite.status not in ('INVITED', 'OPENED')
     or v_invite.expires_at is null or v_invite.expires_at <= now() then
    result := 'UNAVAILABLE'; return next; return;
  end if;

  insert into public.tailor_claim_email_paths(invite_id)
  values (v_invite.id)
  on conflict on constraint tailor_claim_email_paths_pkey do nothing;

  select * into v_path
  from public.tailor_claim_email_paths
  where public.tailor_claim_email_paths.invite_id = v_invite.id
  for update;

  if v_path.locked_at is not null then
    result := 'EMAIL_LOCKED'; invite_id := v_invite.id; return next; return;
  end if;

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '1 day')
    into v_hour_count, v_day_count
  from public.tailor_claim_email_codes
  where public.tailor_claim_email_codes.invite_id = v_invite.id;

  if v_hour_count >= 5 or v_day_count >= 10 then
    update public.tailor_claim_email_paths
      set locked_at = now(), lock_reason = 'CODE_REQUEST_LIMIT', updated_at = now()
    where public.tailor_claim_email_paths.invite_id = v_invite.id;
    result := 'EMAIL_LOCKED'; invite_id := v_invite.id; return next; return;
  end if;

  update public.tailor_claim_email_codes
    set status = case when expires_at <= now() then 'EXPIRED' else 'SUPERSEDED' end,
        updated_at = now()
  where public.tailor_claim_email_codes.invite_id = v_invite.id
    and status = 'PENDING';

  insert into public.tailor_claim_email_codes(invite_id, email_hash, code_hash, expires_at)
  values (v_invite.id, p_email_hash, p_code_hash, now() + interval '10 minutes')
  returning id into v_code_id;

  insert into public.tailor_claim_email_jobs(code_id, invite_id, email_hash)
  values (v_code_id, v_invite.id, p_email_hash)
  returning id into v_job_id;

  result := 'ISSUED'; invite_id := v_invite.id; code_id := v_code_id; job_id := v_job_id;
  return next;
end;
$$;

revoke all on function public.issue_tailor_claim_email_code(text, text, text) from public, anon, authenticated;
grant execute on function public.issue_tailor_claim_email_code(text, text, text) to service_role;
