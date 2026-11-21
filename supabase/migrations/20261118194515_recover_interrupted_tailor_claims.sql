-- Development-only PR 2, Stage 3 migration 4/5.
-- Recover abandoned CLAIMING transitions and permit a failed receipt to be
-- replaced only after its failure is preserved in the audit log.

alter function public.prepare_tailor_profile_claim(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)
  rename to prepare_tailor_profile_claim_v1;

revoke all on function public.prepare_tailor_profile_claim_v1(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)
  from public,anon,authenticated,service_role;

create function public.prepare_tailor_profile_claim(
  p_token_hash text,p_bootstrap_session_id uuid,p_user_id uuid,p_auth_session_id uuid,
  p_idempotency_key text,p_email text,p_email_hash text,p_phone text,p_pickup_address text,
  p_pickup_address_line1 text,p_pickup_city text,p_pickup_region text,p_pickup_postal_code text,
  p_pickup_country_code text,p_consent_text_version text,p_consent_media_manifest jsonb
) returns table(result text,receipt_id uuid,invite_id uuid,user_id uuid,response jsonb)
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_invite_id uuid; v_failed public.tailor_claim_transition_receipts%rowtype;
begin
  select i.id into v_invite_id from public.tailor_claim_invites i
  join public.tailor_claim_bootstrap_sessions b on b.invite_id=i.id
  where b.id=p_bootstrap_session_id and b.user_id=p_user_id and b.auth_session_id=p_auth_session_id
    and b.status='ACTIVE' and b.expires_at>now() and i.token_hash=p_token_hash
    and i.status in ('INVITED','OPENED') for update of i,b;
  if v_invite_id is not null then
    select * into v_failed from public.tailor_claim_transition_receipts
      where public.tailor_claim_transition_receipts.invite_id=v_invite_id and outcome='FAILED' for update;
    if found then
      insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
        p_user_id::text,'TAILOR','tailor_claim.failed_receipt_replaced','info',
        jsonb_build_object('invite_id',v_invite_id,'receipt_id',v_failed.id,
          'failure_code',v_failed.failure_code,'replacement_idempotency_key',trim(p_idempotency_key)));
      delete from public.tailor_claim_transition_receipts where id=v_failed.id;
    end if;
  end if;
  return query select * from public.prepare_tailor_profile_claim_v1(
    p_token_hash,p_bootstrap_session_id,p_user_id,p_auth_session_id,p_idempotency_key,
    p_email,p_email_hash,p_phone,p_pickup_address,p_pickup_address_line1,p_pickup_city,
    p_pickup_region,p_pickup_postal_code,p_pickup_country_code,p_consent_text_version,
    p_consent_media_manifest);
end;
$$;
revoke all on function public.prepare_tailor_profile_claim(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_tailor_profile_claim(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.fail_tailor_profile_claim_conflict(p_receipt_id uuid,p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_receipt public.tailor_claim_transition_receipts%rowtype;
begin
  select * into v_receipt from public.tailor_claim_transition_receipts
    where id=p_receipt_id and user_id=p_user_id and outcome='IN_PROGRESS' for update;
  if not found then return false; end if;
  update public.tailor_claim_transition_receipts set outcome='FAILED',failure_code='ACCOUNT_CONFLICT',completed_at=now() where id=v_receipt.id;
  update public.tailor_claim_invites set status='OPENED',updated_at=now() where id=v_receipt.invite_id and status='CLAIMING';
  update public.tailor_profiles p set lifecycle_state='OPENED',updated_at=now()
    from public.tailor_claim_invites i where i.id=v_receipt.invite_id and p.id::text=i.tailor_profile_id::text and p.lifecycle_state='CLAIMING';
  update public.tailor_claim_bootstrap_sessions set status='FAILED',completed_at=now(),updated_at=now()
    where id=v_receipt.bootstrap_session_id and status='ACTIVE';
  update auth.users set banned_until=greatest(coalesce(banned_until,'-infinity'::timestamptz),now()+interval '100 years'),
    raw_app_meta_data=(coalesce(raw_app_meta_data,'{}'::jsonb)-'claim_session_id')||jsonb_build_object('role','TAILOR','account_origin','STAFF_DRAFT')
    where id=p_user_id;
  delete from auth.sessions where user_id=p_user_id;
  insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
    p_user_id::text,'TAILOR','tailor_claim.account_conflict','warning',
    jsonb_build_object('invite_id',v_receipt.invite_id,'receipt_id',v_receipt.id,
      'bootstrap_session_id',v_receipt.bootstrap_session_id,'relocked',true));
  return true;
end;
$$;
revoke all on function public.fail_tailor_profile_claim_conflict(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fail_tailor_profile_claim_conflict(uuid,uuid) to service_role;

create or replace function public.reap_expired_tailor_claim_bootstrap_sessions(p_limit integer default 25)
returns table(bootstrap_session_id uuid,invite_id uuid,user_id uuid,auth_sessions_revoked integer)
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_row record; v_revoked integer; v_receipt public.tailor_claim_transition_receipts%rowtype;
begin
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'INVALID_REAPER_LIMIT' using errcode='22023'; end if;
  for v_row in
    select s.id,s.invite_id,s.user_id,i.status as invite_status,i.tailor_profile_id
    from public.tailor_claim_bootstrap_sessions s join public.tailor_claim_invites i on i.id=s.invite_id
    where s.status in ('PREPARING','ACTIVE') and s.expires_at<=now()
      and i.status in ('DRAFT','INVITED','OPENED','CLAIMING')
    order by s.expires_at,s.id for update of s,i skip locked limit p_limit
  loop
    update auth.users set banned_until=greatest(coalesce(banned_until,'-infinity'::timestamptz),now()+interval '100 years'),
      raw_app_meta_data=(coalesce(raw_app_meta_data,'{}'::jsonb)-'claim_session_id')||jsonb_build_object('role','TAILOR','account_origin','STAFF_DRAFT')
      where id=v_row.user_id;
    if not found then raise exception 'BOOTSTRAP_PLACEHOLDER_NOT_FOUND'; end if;
    delete from auth.sessions where auth.sessions.user_id=v_row.user_id; get diagnostics v_revoked=row_count;
    update public.tailor_claim_bootstrap_sessions set status='EXPIRED',activated_at=null,completed_at=now(),updated_at=now() where id=v_row.id;
    if v_row.invite_status='CLAIMING' then
      select * into v_receipt from public.tailor_claim_transition_receipts
        where public.tailor_claim_transition_receipts.invite_id=v_row.invite_id
          and public.tailor_claim_transition_receipts.bootstrap_session_id=v_row.id
          and public.tailor_claim_transition_receipts.outcome='IN_PROGRESS' for update;
      if found then
        update public.tailor_claim_transition_receipts set outcome='FAILED',failure_code='BOOTSTRAP_EXPIRED',completed_at=now() where id=v_receipt.id;
        update public.tailor_claim_invites set status='OPENED',updated_at=now() where id=v_row.invite_id and status='CLAIMING';
        update public.tailor_profiles set lifecycle_state='OPENED',updated_at=now()
          where id::text=v_row.tailor_profile_id::text and lifecycle_state='CLAIMING';
        insert into public.audit_logs(actor_id,actor_role,event,severity,payload) values(
          v_row.user_id::text,'SYSTEM','tailor_claim.interrupted_claim_recovered','warning',
          jsonb_build_object('invite_id',v_row.invite_id,'receipt_id',v_receipt.id,
            'bootstrap_session_id',v_row.id,'failure_code','BOOTSTRAP_EXPIRED'));
      end if;
    end if;
    bootstrap_session_id:=v_row.id; invite_id:=v_row.invite_id; user_id:=v_row.user_id; auth_sessions_revoked:=v_revoked; return next;
  end loop;
end;
$$;
revoke all on function public.reap_expired_tailor_claim_bootstrap_sessions(integer) from public,anon,authenticated;
grant execute on function public.reap_expired_tailor_claim_bootstrap_sessions(integer) to service_role;
