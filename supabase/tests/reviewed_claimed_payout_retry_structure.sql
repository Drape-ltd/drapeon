begin;

insert into public.payout_claims (
  id,business_key,source_kind,source_id,order_id,tailor_profile_id,provider,
  provider_destination_id,currency,amount,route_version,earning_policy_version,
  provider_idempotency_key
) values (
  '72000000-0000-4000-8000-000000000010',
  'qa:earning:72000000-0000-4000-8000-000000000010','ORDER_EARNING',
  'qa-order','qa-order','qa-tailor','STRIPE','acct_qa_same_destination',
  'USD',8400,'qa-route','qa-policy','qa:earning:72000000-0000-4000-8000-000000000010'
);
insert into public.payout_provider_operations (
  id,claim_id,operation_number,provider,provider_destination_id,currency,amount,
  provider_idempotency_key,status,provider_source_transaction_id
) values (
  '72000000-0000-4000-8000-000000000011',
  '72000000-0000-4000-8000-000000000010',1,'STRIPE',
  'acct_qa_same_destination','USD',8400,
  'qa:earning:72000000-0000-4000-8000-000000000010',
  'FAILED_RETURNED','ch_qa_source'
);
insert into public.money_desk_requests(id)
values ('72000000-0000-4000-8000-000000000020');
insert into public.payout_claim_retry_authorizations (
  id,claim_id,prior_operation_id,money_desk_request_id,operation_number,
  provider,provider_destination_id,currency,amount,provider_source_transaction_id,
  final_failure_reference,funds_return_reference
) values (
  '72000000-0000-4000-8000-000000000021',
  '72000000-0000-4000-8000-000000000010',
  '72000000-0000-4000-8000-000000000011',
  '72000000-0000-4000-8000-000000000020',2,'STRIPE',
  'acct_qa_same_destination','USD',8400,'ch_qa_source',
  'req_qa_definite_rejection','NOT_SENT:transfers_not_enabled'
);
insert into public.payout_provider_operations (
  claim_id,operation_number,provider,provider_destination_id,currency,amount,
  provider_idempotency_key,status,provider_source_transaction_id,
  money_desk_request_id,reviewed_retry_id
) values (
  '72000000-0000-4000-8000-000000000010',2,'STRIPE',
  'acct_qa_same_destination','USD',8400,
  'qa:earning:72000000-0000-4000-8000-000000000010:op:2',
  'RESERVED','ch_qa_source',
  '72000000-0000-4000-8000-000000000020',
  '72000000-0000-4000-8000-000000000021'
);

do $test$
begin
  if (select count(*) from public.payout_provider_operations
      where operation_number=2 and reviewed_retry_id is not null
        and reviewed_correction_id is null) <> 1 then
    raise exception 'Same-destination reviewed operation did not satisfy structure';
  end if;
  if not (select relrowsecurity from pg_class
      where oid='public.payout_claim_retry_authorizations'::regclass) then
    raise exception 'Retry authorization table lacks RLS';
  end if;
  if has_table_privilege('anon','public.payout_claim_retry_authorizations','SELECT')
    or has_table_privilege('authenticated','public.payout_claim_retry_authorizations','SELECT')
    or not has_table_privilege('service_role','public.payout_claim_retry_authorizations','SELECT') then
    raise exception 'Retry authorization grants are incorrect';
  end if;
  raise notice 'PASS structural retry authorization and service-role grants';
end;
$test$;

rollback;
