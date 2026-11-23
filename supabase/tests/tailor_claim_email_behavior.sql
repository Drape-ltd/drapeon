do $test$
declare
  v_placeholder uuid := '10000000-0000-0000-0000-000000000001';
  v_existing uuid := '10000000-0000-0000-0000-000000000002';
  v_invite uuid := '20000000-0000-0000-0000-000000000001';
  v_issue record;
  v_result record;
begin
  insert into auth.users(id, email) values
    (v_placeholder, 'placeholder@invalid.example'),
    (v_existing, 'existing@example.com');
  insert into public.users(id, email) values
    (v_placeholder, 'placeholder@invalid.example'),
    (v_existing, 'existing@example.com');
  insert into public.tailor_claim_invites(id, tailor_user_id, token_hash, status, expires_at)
  values (v_invite, v_placeholder, repeat('t', 43), 'INVITED', now() + interval '1 day');

  select * into v_issue from public.issue_tailor_claim_email_code(
    repeat('t', 43), repeat('e', 43), repeat('c', 43)
  );

  update public.tailor_claim_invites set status = 'REVOKED' where id = v_invite;
  select * into v_result from public.verify_tailor_claim_email_code(
    repeat('t', 43), 'existing@example.com', repeat('e', 43), repeat('c', 43)
  );
  if v_result.result <> 'UNAVAILABLE' then raise exception 'revoked invite leaked collision: %', v_result.result; end if;

  update public.tailor_claim_invites set status = 'INVITED', expires_at = now() - interval '1 second' where id = v_invite;
  select * into v_result from public.verify_tailor_claim_email_code(
    repeat('t', 43), 'existing@example.com', repeat('e', 43), repeat('c', 43)
  );
  if v_result.result <> 'UNAVAILABLE' then raise exception 'expired invite leaked collision: %', v_result.result; end if;

  update public.tailor_claim_invites set expires_at = now() + interval '1 day' where id = v_invite;
  update public.tailor_claim_email_paths
    set locked_at = now(), lock_reason = 'CODE_REQUEST_LIMIT' where invite_id = v_invite;
  select * into v_result from public.verify_tailor_claim_email_code(
    repeat('t', 43), 'existing@example.com', repeat('e', 43), repeat('c', 43)
  );
  if v_result.result <> 'EMAIL_LOCKED' then raise exception 'locked path leaked collision: %', v_result.result; end if;

  update public.tailor_claim_email_paths set locked_at = null, lock_reason = null where invite_id = v_invite;
  update public.tailor_claim_email_codes set expires_at = now() - interval '1 second' where id = v_issue.code_id;
  select * into v_result from public.verify_tailor_claim_email_code(
    repeat('t', 43), 'existing@example.com', repeat('e', 43), repeat('c', 43)
  );
  if v_result.result <> 'CODE_EXPIRED' then raise exception 'expired code leaked collision: %', v_result.result; end if;

  update public.tailor_claim_email_codes
    set status = 'PENDING', expires_at = now() + interval '10 minutes', updated_at = now()
    where id = v_issue.code_id;
  select * into v_result from public.verify_tailor_claim_email_code(
    repeat('t', 43), 'existing@example.com', repeat('e', 43), repeat('c', 43)
  );
  if v_result.result <> 'ACCOUNT_CONFLICT' then raise exception 'valid collision was not found: %', v_result.result; end if;
end
$test$;

select 'tailor_claim_email_fresh_postgres_passed' as result;

