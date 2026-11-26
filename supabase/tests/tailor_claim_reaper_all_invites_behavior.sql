do $$
declare v_rows integer;
begin
  select count(*) into v_rows from public.reap_expired_tailor_claim_bootstrap_sessions(1);
  if v_rows<>1 then raise exception 'First bounded run returned % rows, expected 1',v_rows; end if;
  select count(*) into v_rows from public.reap_expired_tailor_claim_bootstrap_sessions(1);
  if v_rows<>1 then raise exception 'Second bounded run returned % rows, expected 1',v_rows; end if;
  select count(*) into v_rows from public.reap_expired_tailor_claim_bootstrap_sessions(1);
  if v_rows<>1 then raise exception 'Third bounded run returned % rows, expected 1',v_rows; end if;
  select count(*) into v_rows from public.reap_expired_tailor_claim_bootstrap_sessions(1);
  if v_rows<>0 then raise exception 'Idempotent fourth run returned % rows',v_rows; end if;
  if exists(select 1 from public.tailor_claim_bootstrap_sessions where status<>'EXPIRED') then
    raise exception 'An expired ACTIVE bootstrap was not ended';
  end if;
  if exists(select 1 from auth.sessions) then raise exception 'Bootstrap Auth sessions survived'; end if;
  if not exists(select 1 from auth.users where id='00000000-0000-0000-0000-000000000001'
     and banned_until>now()+interval '99 years') then
    raise exception 'Expired invite did not re-ban its placeholder';
  end if;
  if not exists(select 1 from auth.users where id='00000000-0000-0000-0000-000000000003'
     and banned_until>now()+interval '99 years') then
    raise exception 'Revoked invite PREPARING session did not re-ban its placeholder';
  end if;
  if exists(select 1 from auth.users where id='00000000-0000-0000-0000-000000000002'
     and banned_until>now()) then raise exception 'Claimed user was re-banned'; end if;
  if (select status from public.tailor_claim_invites where id='10000000-0000-0000-0000-000000000001')<>'EXPIRED' then
    raise exception 'Reaper changed expired invite state';
  end if;
  if (select status from public.tailor_claim_invites where id='10000000-0000-0000-0000-000000000003')<>'REVOKED' then
    raise exception 'Reaper changed revoked invite state';
  end if;
end;
$$;
select 'tailor_claim_reaper_all_invites_passed' as result;
