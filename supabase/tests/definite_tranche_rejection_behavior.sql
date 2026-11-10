-- Runs in an isolated Postgres container with Dev's payout column types.
-- The provider evidence is synthetic; no Stripe call or money mutation occurs.
begin;

insert into public.orders(id,id_text,accepted_route_snapshot_at)
values ('71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',now());
insert into public.payout_claims (
  id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
  provider_destination_id,currency,amount,route_version,earning_policy_version,
  provider_idempotency_key,status,transfer_status,payout_id
) values (
  '71000000-0000-4000-8000-000000000002','qa:tranche:one',
  'SETTLEMENT_TRANCHE','71000000-0000-4000-8000-000000000003',
  '71000000-0000-4000-8000-000000000001','qa-tailor','STRIPE',
  'acct_qa_destination','USD',8400,'qa-route','qa-policy',
  'qa:tranche:one','PROVIDER_UNKNOWN','PROVIDER_UNKNOWN','qa-payout-one'
);
insert into public.payout_provider_operations (
  id,claim_id,operation_number,provider,provider_destination_id,currency,
  amount,provider_idempotency_key,status
) values (
  '71000000-0000-4000-8000-000000000004',
  '71000000-0000-4000-8000-000000000002',1,'STRIPE',
  'acct_qa_destination','USD',8400,'qa:tranche:one','PROVIDER_UNKNOWN'
);
insert into public.payout_attempts (
  id,claim_id,claim_operation_id,attempt_number,status,provider_evidence
) values
  ('71000000-0000-4000-8000-000000000005',
   '71000000-0000-4000-8000-000000000002',
   '71000000-0000-4000-8000-000000000004',1,'PROVIDER_UNKNOWN',
   '{"definite_rejection":true,"stripe_code":"transfers_not_enabled",
     "stripe_request_id":"req_qa_rejected"}'::jsonb),
  ('71000000-0000-4000-8000-000000000006',
   '71000000-0000-4000-8000-000000000002',
   '71000000-0000-4000-8000-000000000004',2,'PREPARED','{}'::jsonb);
insert into public.payouts (
  id,id_text,order_id,settlement_tranche_id,payout_purpose,provider,
  provider_destination_id,amount,currency,status,provider_transfer_status,
  bank_settlement_status
) values (
  'qa-payout-one','qa-payout-one',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000003','SETTLEMENT_TRANCHE',
  'STRIPE','acct_qa_destination',8400,'USD','PROCESSING','PROCESSING','PENDING'
);
insert into public.order_settlement_tranches (
  id,order_id,amount,currency,status,payout_id,updated_at
) values (
  '71000000-0000-4000-8000-000000000003',
  '71000000-0000-4000-8000-000000000001',8400,'USD',
  'RELEASE_REQUESTED','qa-payout-one',now()
);

-- Adjacent fabric claim still uses the same definite-rejection RPC, without
-- entering the settlement-tranche close-out branch.
insert into public.payout_claims (
  id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
  provider_destination_id,currency,amount,route_version,earning_policy_version,
  provider_idempotency_key,status,transfer_status
) values (
  '71000000-0000-4000-8000-000000000007','qa:fabric:one',
  'FABRIC_RELEASE','qa-fabric-candidate',
  '71000000-0000-4000-8000-000000000001','qa-tailor','STRIPE',
  'acct_qa_destination','USD',8000,'qa-route','qa-policy',
  'qa:fabric:one','PROVIDER_UNKNOWN','PROVIDER_UNKNOWN'
);
insert into public.payout_provider_operations (
  id,claim_id,operation_number,provider,provider_destination_id,currency,
  amount,provider_idempotency_key,status
) values (
  '71000000-0000-4000-8000-000000000008',
  '71000000-0000-4000-8000-000000000007',1,'STRIPE',
  'acct_qa_destination','USD',8000,'qa:fabric:one','PROVIDER_UNKNOWN'
);
insert into public.payout_attempts (
  id,claim_id,claim_operation_id,attempt_number,status,provider_evidence
) values
  ('71000000-0000-4000-8000-000000000009',
   '71000000-0000-4000-8000-000000000007',
   '71000000-0000-4000-8000-000000000008',1,'PROVIDER_UNKNOWN',
   '{"definite_rejection":true,"stripe_code":"transfers_not_enabled",
     "stripe_request_id":"req_qa_fabric_rejected"}'::jsonb),
  ('71000000-0000-4000-8000-000000000010',
   '71000000-0000-4000-8000-000000000007',
   '71000000-0000-4000-8000-000000000008',2,'PREPARED','{}'::jsonb);

do $test$
declare
  v_result jsonb;
begin
  v_result := public.reconcile_definite_payout_rejection(
    '71000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000006',
    '{"provider":"STRIPE","reason":"lookup_unavailable"}'::jsonb);
  if v_result->>'outcome'<>'NOT_DEFINITE'
    or (select status from public.payout_claims
      where id='71000000-0000-4000-8000-000000000002')<>'PROVIDER_UNKNOWN'
    or (select status from public.payouts where id='qa-payout-one')<>'PROCESSING' then
    raise exception 'Ambiguous provider result changed payout state';
  end if;

  v_result := public.reconcile_definite_payout_rejection(
    '71000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000006',
    '{"provider":"STRIPE","reason":"no_transfer_found_for_operation"}'::jsonb);
  if v_result->>'outcome'<>'FAILED_RECONCILED'
    or (select status from public.payout_claims
      where id='71000000-0000-4000-8000-000000000002')<>'FAILED_RECONCILED'
    or (select status from public.payout_provider_operations
      where id='71000000-0000-4000-8000-000000000004')<>'FAILED_RETURNED'
    or (select status from public.payouts where id='qa-payout-one')<>'FAILED'
    or (select provider_response->>'claim_operation_id' from public.payouts
      where id='qa-payout-one')<>'71000000-0000-4000-8000-000000000004'
    or (select status from public.order_settlement_tranches
      where id='71000000-0000-4000-8000-000000000003')<>'BLOCKED'
    or (select count(*) from public.ops_issues
      where related_entity_id='71000000-0000-4000-8000-000000000002')<>2 then
    raise exception 'Definite rejection left a tranche or payout open';
  end if;
  v_result := public.reconcile_definite_payout_rejection(
    '71000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000006',
    '{"provider":"STRIPE","reason":"no_transfer_found_for_operation"}'::jsonb);
  if v_result->>'outcome'<>'NOT_DEFINITE'
    or (select count(*) from public.ops_issues
      where related_entity_id='71000000-0000-4000-8000-000000000002')<>2
    or (select count(*) from public.payout_provider_operations
      where claim_id='71000000-0000-4000-8000-000000000002')<>1 then
    raise exception 'Definite rejection replay created another operation or issue';
  end if;
  v_result := public.reconcile_definite_payout_rejection(
    '71000000-0000-4000-8000-000000000007',
    '71000000-0000-4000-8000-000000000010',
    '{"provider":"STRIPE","reason":"no_transfer_found_for_operation"}'::jsonb);
  if v_result->>'outcome'<>'FAILED_RECONCILED'
    or (select status from public.payout_claims
      where id='71000000-0000-4000-8000-000000000007')<>'FAILED_RECONCILED'
    or (select status from public.payout_provider_operations
      where id='71000000-0000-4000-8000-000000000008')<>'FAILED_RETURNED'
    or (select status from public.payouts where id='qa-payout-one')<>'FAILED'
    or (select status from public.order_settlement_tranches
      where id='71000000-0000-4000-8000-000000000003')<>'BLOCKED' then
    raise exception 'Adjacent fabric rejection changed the tranche or failed to close';
  end if;
  raise notice 'PASS definite rejection closes one unpaid tranche and payout; replay is inert';
end;
$test$;

rollback;
