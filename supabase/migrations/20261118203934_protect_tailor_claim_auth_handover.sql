-- Development-only PR 2, Stage 3 migration 5/5.
-- Once Auth owns the tailor's real credentials, expiry must never restore the
-- placeholder lock. Keep the transition replayable until database completion.

alter table public.tailor_claim_transition_receipts
  add column auth_handover_at timestamptz;

create or replace function public.record_tailor_profile_claim_auth_handover(
  p_receipt_id uuid,
  p_user_id uuid
) returns boolean
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_receipt public.tailor_claim_transition_receipts%rowtype;
  v_auth_user auth.users%rowtype;
begin
  select * into v_receipt
  from public.tailor_claim_transition_receipts
  where id=p_receipt_id and user_id=p_user_id and outcome='IN_PROGRESS'
  for update;
  if not found then return false; end if;

  select * into v_auth_user from auth.users where id=p_user_id for update;
  if not found
     or lower(coalesce(v_auth_user.email,''))<>lower(coalesce(v_receipt.request_payload->>'email',''))
     or coalesce(v_auth_user.raw_app_meta_data->>'account_origin','')<>'CLAIMED'
     or v_auth_user.raw_app_meta_data ? 'claim_session_id'
     or (v_auth_user.banned_until is not null and v_auth_user.banned_until>now()) then
    return false;
  end if;

  update public.tailor_claim_transition_receipts
  set auth_handover_at=coalesce(auth_handover_at,now())
  where id=v_receipt.id;
  return true;
end;
$$;

revoke all on function public.record_tailor_profile_claim_auth_handover(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.record_tailor_profile_claim_auth_handover(uuid,uuid)
  to service_role;

create or replace function public.reap_expired_tailor_claim_bootstrap_sessions(p_limit integer default 25)
returns table(bootstrap_session_id uuid,invite_id uuid,user_id uuid,auth_sessions_revoked integer)
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
  v_row record;
  v_revoked integer;
  v_receipt public.tailor_claim_transition_receipts%rowtype;
  v_auth_handed_over boolean;
begin
  if p_limit is null or p_limit<1 or p_limit>50 then
    raise exception 'INVALID_REAPER_LIMIT' using errcode='22023';
  end if;

  for v_row in
    select s.id,s.invite_id,s.user_id,i.status as invite_status,i.tailor_profile_id
    from public.tailor_claim_bootstrap_sessions s
    join public.tailor_claim_invites i on i.id=s.invite_id
    where s.status in ('PREPARING','ACTIVE') and s.expires_at<=now()
      and i.status in ('DRAFT','INVITED','OPENED','CLAIMING')
    order by s.expires_at,s.id for update of s,i skip locked limit p_limit
  loop
    v_revoked:=0;
    v_auth_handed_over:=false;
    v_receipt:=null;

    if v_row.invite_status='CLAIMING' then
      select * into v_receipt
      from public.tailor_claim_transition_receipts r
      where r.invite_id=v_row.invite_id
        and r.bootstrap_session_id=v_row.id
        and r.outcome='IN_PROGRESS'
      for update;

      if found then
        v_auth_handed_over:=v_receipt.auth_handover_at is not null or exists(
          select 1 from auth.users u
          where u.id=v_row.user_id
            and lower(coalesce(u.email,''))=lower(coalesce(v_receipt.request_payload->>'email',''))
            and coalesce(u.raw_app_meta_data->>'account_origin','')='CLAIMED'
            and not (u.raw_app_meta_data ? 'claim_session_id')
            and (u.banned_until is null or u.banned_until<=now())
        );
      end if;
    end if;

    update public.tailor_claim_bootstrap_sessions
    set status='EXPIRED',activated_at=null,completed_at=now(),updated_at=now()
    where id=v_row.id;

    if v_auth_handed_over then
      update public.tailor_claim_transition_receipts
      set auth_handover_at=coalesce(auth_handover_at,now())
      where id=v_receipt.id;
      insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
        v_row.user_id::text,'SYSTEM','tailor_claim.handover_awaiting_replay','warning',
        jsonb_build_object('invite_id',v_row.invite_id,'receipt_id',v_receipt.id,
          'bootstrap_session_id',v_row.id));
    else
      update auth.users
      set banned_until=greatest(coalesce(banned_until,'-infinity'::timestamptz),now()+interval '100 years'),
        raw_app_meta_data=(coalesce(raw_app_meta_data,'{}'::jsonb)-'claim_session_id')
          ||jsonb_build_object('role','TAILOR','account_origin','STAFF_DRAFT')
      where id=v_row.user_id;
      if not found then raise exception 'BOOTSTRAP_PLACEHOLDER_NOT_FOUND'; end if;

      delete from auth.sessions where auth.sessions.user_id=v_row.user_id;
      get diagnostics v_revoked=row_count;

      if v_row.invite_status='CLAIMING' and v_receipt.id is not null then
        update public.tailor_claim_transition_receipts
        set outcome='FAILED',failure_code='BOOTSTRAP_EXPIRED',completed_at=now()
        where id=v_receipt.id;
        update public.tailor_claim_invites set status='OPENED',updated_at=now()
        where id=v_row.invite_id and status='CLAIMING';
        update public.tailor_profiles set lifecycle_state='OPENED',updated_at=now()
        where id::text=v_row.tailor_profile_id::text and lifecycle_state='CLAIMING';
        insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
          v_row.user_id::text,'SYSTEM','tailor_claim.interrupted_claim_recovered','warning',
          jsonb_build_object('invite_id',v_row.invite_id,'receipt_id',v_receipt.id,
            'bootstrap_session_id',v_row.id,'failure_code','BOOTSTRAP_EXPIRED'));
      end if;
    end if;

    bootstrap_session_id:=v_row.id;
    invite_id:=v_row.invite_id;
    user_id:=v_row.user_id;
    auth_sessions_revoked:=v_revoked;
    return next;
  end loop;
end;
$$;

revoke all on function public.reap_expired_tailor_claim_bootstrap_sessions(integer)
  from public,anon,authenticated;
grant execute on function public.reap_expired_tailor_claim_bootstrap_sessions(integer)
  to service_role;

comment on column public.tailor_claim_transition_receipts.auth_handover_at is
  'Set immediately after Auth receives the real credentials; expiry must preserve replay after this point.';
