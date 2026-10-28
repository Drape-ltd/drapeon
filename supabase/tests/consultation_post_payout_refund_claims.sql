-- Rollback-only integration test for the reviewed, Drapeon-funded consultation
-- refund claim. Uses synthetic identities and never calls a provider.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('70000000-0000-4000-8000-000000000001','authenticated','authenticated','phase2-consult-customer@example.invalid','',now(),'{}','{}',now(),now()),
  ('70000000-0000-4000-8000-000000000002','authenticated','authenticated','phase2-consult-tailor@example.invalid','',now(),'{}','{}',now(),now());

insert into public.customer_profiles (user_id,display_name) values
  ('70000000-0000-4000-8000-000000000001','Phase 2 QA Customer');

insert into public.tailor_profiles (
  id,user_id,display_name,location,payout_currency,is_test_profile,is_live,is_verified
) values (
  '70000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000002',
  'Phase 2 Consultation QA','Local test','USD',true,false,false
);

insert into public.orders (
  id,reference,customer_id,tailor_profile_id,garment_type,description,
  fabric_source,delivery_method,stage
) values (
  '70000000-0000-4000-8000-000000000004',
  'P2-CONSULT-REFUND-QA-20261027',
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000003',
  'QA garment','Rollback-only consultation refund test','TAILOR_SOURCES','SHIPPING','COMPLETE'
);

insert into public.consultation_bookings (
  id,order_id,tailor_id,customer_id,scheduled_start_at,scheduled_end_at,
  fee_mode,fee_amount,fee_currency,status,payment_status,settlement_status,
  earned_amount
) values (
  '70000000-0000-4000-8000-000000000005',
  '70000000-0000-4000-8000-000000000004',
  '70000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000001',
  now() - interval '2 hours',now() - interval '1 hour',
  'PAID',10000,'USD','CONFIRMED','PENDING','HELD',8000
);

insert into public.order_payments (
  id,order_id,phase,provider,currency,amount,status,idempotency_key,
  provider_payment_id,consultation_booking_id,consultation_booking_link_source
) values (
  '70000000-0000-4000-8000-000000000006',
  '70000000-0000-4000-8000-000000000004','CONSULTATION','STRIPE','USD',10000,'SUCCEEDED',
  'qa:consultation-payment','pi_phase2_consult_qa',
  '70000000-0000-4000-8000-000000000005','PREPARED'
);

insert into public.payouts (
  id,tailor_profile_id,amount,currency,provider,provider_payout_id,order_id,
  source_payment_id,status,provider_transfer_status,payout_purpose
) values (
  '70000000-0000-4000-8000-000000000008',
  '70000000-0000-4000-8000-000000000003',8000,'USD','STRIPE','tr_phase2_consult_qa',
  '70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000006',
  'PROCESSING','AVAILABLE_IN_PROVIDER_BALANCE','CONSULTATION_EARNING'
);

update public.consultation_bookings
set payout_id='70000000-0000-4000-8000-000000000008',
    payment_status='PAID',settlement_status='RELEASED'
where id='70000000-0000-4000-8000-000000000005';

insert into public.money_desk_jit_grants (
  id,actor_email,actor_subject,actor_role,assurance_source,action_scopes,reason,expires_at
) values (
  '70000000-0000-4000-8000-000000000009','phase2-ops@example.invalid','qa-subject','FINANCE',
  'MIGRATION_DRY_RUN',array['CUSTOMER_REFUND']::text[],'Synthetic rollback-only approval grant',now() + interval '1 minute'
);

insert into public.money_desk_requests (
  id,idempotency_key,request_hash,action_type,status,target_type,target_id,order_id,
  amount,currency,reason,requester_email,requester_subject,requester_role,
  requester_jit_grant_id,risk_level,required_approval_count,approval_count,executing_at
) values (
  '70000000-0000-4000-8000-000000000010','qa:refund:one','qa-hash-one','CUSTOMER_REFUND','EXECUTING',
  'CONSULTATION_BOOKING','70000000-0000-4000-8000-000000000005',
  '70000000-0000-4000-8000-000000000004',2500,'USD','Rollback-only reviewed consultation refund',
  'phase2-ops@example.invalid','qa-subject','FINANCE',
  '70000000-0000-4000-8000-000000000009','STANDARD',1,1,now()
);

do $test$
declare
  v_first jsonb;
  v_duplicate jsonb;
  v_claim_id uuid;
  v_tx_id uuid := '70000000-0000-4000-8000-000000000011';
  v_result text;
begin
  v_first := public.claim_consultation_post_payout_refund(
    '70000000-0000-4000-8000-000000000005',
    '70000000-0000-4000-8000-000000000006',
    '70000000-0000-4000-8000-000000000010',2500
  );
  if v_first ->> 'status' <> 'CLAIMED' or v_first ->> 'created' <> 'true' then
    raise exception 'Expected a new exact post-payout refund claim; got %', v_first;
  end if;
  v_claim_id := (v_first ->> 'claimId')::uuid;

  v_duplicate := public.claim_consultation_post_payout_refund(
    '70000000-0000-4000-8000-000000000005',
    '70000000-0000-4000-8000-000000000006',
    '70000000-0000-4000-8000-000000000010',2500
  );
  if v_duplicate ->> 'claimId' <> v_claim_id::text or v_duplicate ->> 'created' <> 'false' then
    raise exception 'Duplicate request did not return the original claim; got %', v_duplicate;
  end if;

  v_result := public.record_consultation_post_payout_refund_provider_result(
    v_claim_id,'re_phase2_consult_qa','PROVIDER_CONFIRMED',
    '{"id":"re_phase2_consult_qa","status":"succeeded"}'::jsonb
  );
  if v_result <> 'PROVIDER_CONFIRMED' then raise exception 'Provider receipt not recorded: %', v_result; end if;

  insert into public.commercial_ledger_transactions (
    id,idempotency_key,request_hash,transaction_kind,purpose,order_id,payment_id,
    policy_version,correlation_id,original_currency,original_amount,
    settlement_currency,settlement_amount,provider_reference,metadata
  ) values (
    v_tx_id,'qa:consult-refund-ledger','qa-ledger-hash','REFUND','CONSULTATION',
    '70000000-0000-4000-8000-000000000004',
    '70000000-0000-4000-8000-000000000006','qa-policy',gen_random_uuid(),
    'USD',2500,'USD',2500,'re_phase2_consult_qa',
    jsonb_build_object('consultation_funded_refund',jsonb_build_object('claim_id',v_claim_id::text))
  );
  v_result := public.finalize_consultation_post_payout_refund_claim(v_claim_id,v_tx_id);
  if v_result <> 'SUCCEEDED' then raise exception 'Claim did not finalize: %', v_result; end if;
  v_result := public.finalize_consultation_post_payout_refund_claim(v_claim_id,v_tx_id);
  if v_result <> 'ALREADY_SUCCEEDED' then raise exception 'Finalize retry was not idempotent: %', v_result; end if;

  if (select settlement_status from public.consultation_bookings where id='70000000-0000-4000-8000-000000000005') <> 'RELEASED'
    or (select earned_amount from public.consultation_bookings where id='70000000-0000-4000-8000-000000000005') <> 8000 then
    raise exception 'Post-payout refund changed the released earning or payout state';
  end if;
end;
$test$;

rollback;
