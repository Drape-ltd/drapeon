-- Run only in the disposable PostgreSQL 17 Production-shaped fixture.
insert into public.order_payments
  (id,order_id,phase,provider,status,currency,amount,ledger_recorded_at,
   idempotency_key)
values
  ('11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222',
   'INITIAL_ORDER','STRIPE','SUCCEEDED','NGN',10000,now(),'phase4-s3-uuid-probe');
insert into public.order_settlement_plans
  (id,order_id,source_payment_id,currency,status,entitlement_amount,
   seller_subtotal_amount,excluded_fabric_allowance_amount)
values
  ('33333333-3333-4333-8333-333333333333',
   '22222222-2222-4222-8222-222222222222',
   '11111111-1111-4111-8111-111111111111',
   'NGN','ACTIVE',8000,8000,0);

do $test$
declare
  z uuid := '00000000-0000-0000-0000-000000000000';
  v_result jsonb;
begin
  if payment_internal.tranche_source_payment_available(z,z,z) then
    raise exception 'Missing source payment was accepted';
  end if;
  -- This call reaches the text plan-ID versus UUID payment-ID comparison.
  -- It must return false only because the synthetic capture has no ledger.
  if payment_internal.tranche_source_payment_available(
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',null) then
    raise exception 'Unledgered synthetic source payment was accepted';
  end if;

  begin
    perform public.apply_reviewed_claimed_payout_retry(z,'qa@example.invalid','ADMIN');
    raise exception 'Missing Money Desk request was accepted';
  exception when raise_exception then
    if SQLERRM <> 'Money Desk request is not a claimed payout retry' then raise; end if;
  end;
  begin
    perform public.close_unstarted_reviewed_claimed_retry(z);
    raise exception 'Missing Money Desk request was accepted';
  exception when raise_exception then
    if SQLERRM <> 'Money Desk request is not a claimed payout retry' then raise; end if;
  end;
  begin
    perform public.load_reviewed_claimed_tranche_retry(z,z,'STRIPE','acct_test','ch_test');
    raise exception 'Missing active payout was accepted';
  exception when raise_exception then
    if SQLERRM <> 'Reviewed tranche retry no longer matches its active payout' then raise; end if;
  end;

  v_result := public.reconcile_definite_payout_rejection(z,z,'{}'::jsonb);
  if v_result->>'outcome' is distinct from 'NOT_DEFINITE' then
    raise exception 'Missing rejection had unexpected outcome: %',v_result;
  end if;
  v_result := public.close_unstarted_settlement_tranche_payout(
    z,'PRE_PROVIDER_ABORT','ch_test');
  if v_result->>'outcome' is distinct from 'NOT_SAFE' then
    raise exception 'Missing tranche had unexpected outcome: %',v_result;
  end if;

  -- These are the Production UUID/text bridges used by the live functions.
  -- Planning happens even when no synthetic row matches.
  perform 1 from public.order_payments p
    join public.order_settlement_plans plan on plan.order_id=p.order_id::text
    where p.id=z;
  perform 1 from public.payout_claims c
    join public.payouts p on p.id_text=c.payout_id
    where c.id=z and p.order_id::text=c.order_id;
  perform 1 from public.disputes d
    join public.orders o on d.order_id=o.id
    where o.id=z;
end;
$test$;

create temp table phase4_payout_status_probe(
  id uuid, amount integer, currency public.currency, provider text,
  provider_payout_id text, provider_destination_id text,
  provider_response jsonb, completed_at timestamptz,
  status public.payout_status
);
insert into phase4_payout_status_probe
  (id,amount,currency,provider,provider_response,status)
values ('44444444-4444-4444-8444-444444444444',100,'NGN','STRIPE','{}','PENDING');
create trigger phase4_payout_status_probe
  before update on phase4_payout_status_probe
  for each row execute function public.guard_payout_forward_status();
update phase4_payout_status_probe set status='PROCESSING';
do $test$
begin
  if (select status from phase4_payout_status_probe)
      is distinct from 'PROCESSING'::public.payout_status then
    raise exception 'Merged payout status guard rejected the normal forward transition';
  end if;
end;
$test$;

create temp table phase4_provider_identity_probe
  (like public.payout_provider_operations including defaults);
insert into phase4_provider_identity_probe
  (claim_id,operation_number,provider,provider_destination_id,currency,
   amount,provider_idempotency_key,status)
values ('55555555-5555-4555-8555-555555555555',1,'STRIPE',
        'acct_test','NGN',100,'phase4-s3-probe','RESERVED');
create trigger phase4_provider_identity_probe
  before update on phase4_provider_identity_probe
  for each row execute function public.prevent_payout_provider_operation_identity_change();
do $test$
begin
  begin
    update phase4_provider_identity_probe set operation_number=2;
    raise exception 'Provider operation identity was mutable';
  exception when raise_exception then
    if SQLERRM <> 'Provider operation identity cannot change' then raise; end if;
  end;
  begin
    perform public.reconcile_failed_order_payment_refund(null,null,'{}'::jsonb);
    raise exception 'Invalid failed-refund evidence was accepted';
  exception when raise_exception then
    if SQLERRM <> 'REFUND_FAILURE_EVIDENCE_INVALID' then raise; end if;
  end;
  if position('reviewed_retry_id' in pg_get_functiondef(
       'public.guard_payout_forward_status()'::regprocedure))=0
    or position('v_returned_evidenced' in pg_get_functiondef(
       'public.guard_payout_forward_status()'::regprocedure))=0
    or position('app.bind_payout_source_transaction' in pg_get_functiondef(
       'public.prevent_payout_provider_operation_identity_change()'::regprocedure))=0
    or position('reversal_of_transaction_id' in pg_get_functiondef(
       'public.reconcile_failed_order_payment_refund(uuid,text,jsonb)'::regprocedure))=0
    or position('drape.payment_refund_failure' in pg_get_functiondef(
       'public.reconcile_failed_order_payment_refund(uuid,text,jsonb)'::regprocedure))=0 then
    raise exception 'Merged PAY-003/C2 guard or refund check is missing';
  end if;
end;
$test$;

create temp table phase4_retry_validate_probe
  (like public.payout_claim_retry_authorizations including defaults);
create trigger phase4_retry_validate_probe
  before insert on phase4_retry_validate_probe
  for each row execute function public.validate_payout_claim_retry_authorization();
do $test$
begin
  begin
    insert into phase4_retry_validate_probe default values;
    raise exception 'Unreviewed retry authorization was accepted';
  exception when raise_exception then
    if SQLERRM <> 'Claimed payout retry requires an executing two-person Money Desk request' then raise; end if;
  end;
end;
$test$;

create temp table phase4_retry_rewrite_probe(id integer);
insert into phase4_retry_rewrite_probe values (1);
create trigger phase4_retry_rewrite_probe
  before update on phase4_retry_rewrite_probe
  for each row execute function public.prevent_payout_claim_retry_authorization_rewrite();
do $test$
begin
  begin
    update phase4_retry_rewrite_probe set id=2;
    raise exception 'Immutable retry authorization was changed';
  exception when raise_exception then
    if SQLERRM <> 'Reviewed claimed-payout retry authorization is immutable' then raise; end if;
  end;
end;
$test$;

do $test$
begin
  if (select count(*) from pg_trigger
      where tgrelid='public.payout_claim_retry_authorizations'::regclass
        and not tgisinternal and tgenabled='O') <> 2 then
    raise exception 'Retry authorization guards are not both enabled';
  end if;
  if not exists (select 1 from pg_constraint
      where conrelid='public.payout_provider_operations'::regclass
        and conname='payout_provider_operations_check'
        and pg_get_constraintdef(oid) like '%reviewed_retry_id%') then
    raise exception 'Reviewed retry CHECK is absent';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.proname in ('tranche_source_payment_available',
      'validate_payout_claim_retry_authorization',
      'prevent_payout_claim_retry_authorization_rewrite',
      'apply_reviewed_claimed_payout_retry',
      'close_unstarted_reviewed_claimed_retry',
      'load_reviewed_claimed_tranche_retry',
      'reconcile_definite_payout_rejection',
      'close_unstarted_settlement_tranche_payout')
      and (has_function_privilege('anon',p.oid,'EXECUTE')
        or has_function_privilege('authenticated',p.oid,'EXECUTE'))
  ) then raise exception 'Client EXECUTE leaked on an S3 function'; end if;
end;
$test$;
