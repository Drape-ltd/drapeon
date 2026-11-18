do $$
declare
  v_user uuid:='00000000-0000-0000-0000-000000000001';
  v_other uuid:='00000000-0000-0000-0000-000000000002';
  v_profile uuid:='00000000-0000-0000-0000-000000000003';
  v_invite uuid:='00000000-0000-0000-0000-000000000004';
  v_bootstrap uuid:='00000000-0000-0000-0000-000000000005';
  v_auth_session uuid:='00000000-0000-0000-0000-000000000006';
  v_receipt uuid:='00000000-0000-0000-0000-000000000007';
  v_result text;
  v_response jsonb;
begin
  insert into auth.users(id,email) values(v_user,'placeholder@invalid.test'),(v_other,'other@example.test');
  insert into public.users(id,email,phone) values
    (v_user,'placeholder@invalid.test',null),(v_other,'other@example.test','+15551234567');
  insert into public.tailor_profiles(id,display_name,lifecycle_state) values(v_profile,'Test Tailor','OPENED');
  insert into public.tailor_claim_invites(id,tailor_user_id,tailor_profile_id,token_hash,status,expires_at)
    values(v_invite,v_user,v_profile,repeat('a',43),'OPENED',now()+interval '1 hour');
  insert into public.tailor_claim_bootstrap_sessions(
    id,invite_id,user_id,auth_session_id,status,expires_at
  ) values(v_bootstrap,v_invite,v_user,v_auth_session,'ACTIVE',now()+interval '10 minutes');

  select result into v_result from public.prepare_tailor_profile_claim(
    repeat('a',43),v_bootstrap,v_user,v_auth_session,'tailor-claim:test-idempotency',
    'tailor@example.test',null,'+15551234567','123 Main St, City, ST 12345',
    '123 Main St','City','State','12345','US','v1','[]'::jsonb
  );
  if v_result<>'PHONE_ALREADY_IN_USE' then raise exception 'prepare did not reject duplicate phone: %',v_result; end if;
  if (select email from auth.users where id=v_user)<>'placeholder@invalid.test' then
    raise exception 'Auth changed before phone guard';
  end if;

  update public.tailor_claim_invites set status='CLAIMING' where id=v_invite;
  update public.tailor_profiles set lifecycle_state='CLAIMING' where id=v_profile;
  insert into public.tailor_claim_transition_receipts(
    id,invite_id,user_id,bootstrap_session_id,idempotency_key,outcome,request_payload,auth_handover_at
  ) values(
    v_receipt,v_invite,v_user,v_bootstrap,'tailor-claim:test-idempotency','IN_PROGRESS',
    jsonb_build_object('phone','+15551234567','pickupAddress','123 Main St, City, ST 12345',
      'pickupAddressLine1','123 Main St','pickupCity','City','pickupRegion','State',
      'pickupPostalCode','12345','pickupCountryCode','US','consentTextVersion','v1',
      'consentMediaManifest','[]'::jsonb),now()
  );
  begin
    perform public.complete_tailor_profile_claim(v_receipt,v_user,'tailor@example.test');
    raise exception 'forced completion conflict was not raised';
  exception when sqlstate 'P1001' then
    if public.update_tailor_profile_claim_phone(v_receipt,v_user,'+15557654321')<>'PHONE_UPDATED' then
      raise exception 'corrected phone was not accepted';
    end if;
  end;
  v_response:=public.complete_tailor_profile_claim(v_receipt,v_user,'tailor@example.test');
  if v_response->>'state'<>'CLAIMED_AWAITING_EMAIL' then raise exception 'claim did not complete: %',v_response; end if;
  if (select phone from public.users where id=v_user)<>'+15557654321' then raise exception 'corrected phone not persisted'; end if;
  if not exists(select 1 from public.audit_logs where event='tailor_claim.phone_corrected_after_handover') then
    raise exception 'phone correction audit missing';
  end if;

  raise notice 'tailor_claim_phone_guard_fresh_postgres_passed';
end;
$$;
