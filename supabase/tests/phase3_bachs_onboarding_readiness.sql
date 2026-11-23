-- Rollback-only behavior proof for the Bachs destination readiness gate.
begin;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000093', 'authenticated', 'authenticated',
  'phase3-readiness@example.invalid', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"TAILOR","display_name":"Readiness QA"}'::jsonb, now(), now());

insert into public.tailor_profiles (id, user_id, display_name, location, currency,
  payout_currency, payout_country_code, is_test_profile, is_live, is_verified)
values ('f3a00000-0000-4000-8000-000000000093', '00000000-0000-4000-8000-000000000093',
  'Readiness QA', 'Test only', 'NGN', 'NGN', 'NG', true, false, false);

insert into public.ops_workforce_principals (id, email, status, roles, permitted_environments, created_by)
values ('f3a00000-0000-4000-8000-000000000094', 'phase3-readiness-ops@example.invalid',
  'ACTIVE', array['admin']::text[], array['development']::text[], 'rollback-test');

insert into public.payout_destinations (id, tailor_profile_id, provider, legal_entity,
  country_code, currency, provider_account_ref, transfers_enabled, payouts_enabled,
  fees_collector, first_withdrawal_review_status, active, capability_checked_at,
  provider_onboarding_due_count, provider_onboarding_pending_count, provider_onboarding_checked_at)
values ('f3a00000-0000-4000-8000-000000000095', 'f3a00000-0000-4000-8000-000000000093',
  'BACHS', 'DRAPE_MARKETPLACE_LIMITED', 'NG', 'NGN', 'acct_phase3_readiness_qa', true, true,
  'PLATFORM', 'PENDING', false, now(), 1, 0, now());

do $test$
declare
  v_destination uuid := 'f3a00000-0000-4000-8000-000000000095';
  v_actor uuid := 'f3a00000-0000-4000-8000-000000000094';
  v_result jsonb;
begin
  begin
    insert into public.payout_destinations (tailor_profile_id, provider, legal_entity, country_code,
      currency, provider_account_ref, transfers_enabled, payouts_enabled, fees_collector,
      first_withdrawal_review_status, active, capability_checked_at)
    values ('f3a00000-0000-4000-8000-000000000093', 'BACHS', 'DRAPE_MARKETPLACE_LIMITED',
      'NG', 'NGN', 'acct_phase3_missing_onboarding', true, true, 'PLATFORM', 'CLEARED', false, now());
    raise exception 'insert cleared without onboarding evidence';
  exception when check_violation then null;
  end;

  begin
    perform public.ops_review_bachs_first_payout_release(v_destination, v_actor, 'CLEARED', 'qa-evidence', 'QA requirements must be complete');
    raise exception 'review cleared while requirements were due';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.payout_destination_review_events where payout_destination_id=v_destination) then
    raise exception 'rejected review left an audit event';
  end if;

  update public.payout_destinations set provider_onboarding_due_count=0, provider_onboarding_pending_count=1 where id=v_destination;
  begin
    perform public.ops_review_bachs_first_payout_release(v_destination, v_actor, 'CLEARED', 'qa-evidence', 'QA pending review must block');
    raise exception 'review cleared while verification was pending';
  exception when check_violation then null;
  end;

  update public.payout_destinations set provider_onboarding_pending_count=0, provider_onboarding_checked_at=null where id=v_destination;
  begin
    perform public.ops_review_bachs_first_payout_release(v_destination, v_actor, 'CLEARED', 'qa-evidence', 'QA missing check must block');
    raise exception 'review cleared without onboarding evidence';
  exception when check_violation then null;
  end;

  update public.payout_destinations set provider_onboarding_checked_at=now()-interval '16 minutes' where id=v_destination;
  begin
    perform public.ops_review_bachs_first_payout_release(v_destination, v_actor, 'CLEARED', 'qa-evidence', 'QA stale check must block');
    raise exception 'review cleared with stale onboarding evidence';
  exception when check_violation then null;
  end;

  update public.payout_destinations set provider_onboarding_checked_at=now() where id=v_destination;
  v_result := public.ops_review_bachs_first_payout_release(v_destination, v_actor, 'CLEARED', 'qa-evidence', 'QA complete onboarding review');
  if v_result->>'active' <> 'true' then raise exception 'complete onboarding did not clear'; end if;

  begin
    update public.payout_destinations set provider_onboarding_due_count=1 where id=v_destination;
    raise exception 'active destination retained while a requirement was due';
  exception when check_violation then null;
  end;
  update public.payout_destinations set active=false, provider_onboarding_due_count=1,
    capability_checked_at=clock_timestamp() where id=v_destination;
  begin
    update public.payout_destinations set active=true, capability_checked_at=clock_timestamp()+interval '1 second' where id=v_destination;
    raise exception 'incomplete destination reactivated';
  exception when check_violation then null;
  end;
end
$test$;

rollback;
