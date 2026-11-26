-- Forward-only merged money guards after the additive S3 retry repair.
do $guard$
declare v_environment text; v_project_ref text;
begin
  select environment,project_ref into v_environment,v_project_ref
  from public.ops_runtime_configuration where singleton is true;
  if (v_environment,v_project_ref) not in
    (('DEVELOPMENT','pqptfuqogvrajozfsqzi'),('PRODUCTION','wkfsrunetmgjdtcurmoj')) then
    raise exception 'PHASE4_S3_MERGED_GUARD_PROJECT_GUARD';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations
                 where version='20261126173651') then
    raise exception 'PHASE4_S3_RETRY_REPAIR_PREREQUISITE';
  end if;
end;
$guard$;

-- Merge the reviewed retry branch into the existing PAY-003/C2 payout guard.
CREATE OR REPLACE FUNCTION public.guard_payout_forward_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old text := old.status::text;
  v_new text := new.status::text;
  v_reversal_evidenced boolean := coalesce(current_setting('drape.payout_transfer_reversal', true), '') = 'evidenced';
  v_returned_evidenced boolean := coalesce(current_setting('drape.payout_returned_funds', true), '') = 'evidenced';
  v_reviewed_recovery boolean := false;
begin
  if new.amount is distinct from old.amount or new.currency is distinct from old.currency
     or new.provider is distinct from old.provider then
    raise exception 'PAYOUT_MONEY_IDENTITY_IMMUTABLE';
  end if;
  if old.provider_payout_id is not null and new.provider_payout_id is distinct from old.provider_payout_id then
    raise exception 'PAYOUT_PROVIDER_TRANSFER_ID_IMMUTABLE';
  end if;
  if old.provider_destination_id is not null and new.provider_destination_id is distinct from old.provider_destination_id then
    select exists (
      select 1 from public.payout_destination_corrections correction
      join public.payout_destinations destination on destination.id=correction.replacement_destination_id
      join public.payout_provider_operations operation
        on operation.reviewed_correction_id = correction.id and operation.claim_id=correction.claim_id
      where correction.failed_payout_id::text=old.id::text
        and destination.provider_account_ref=new.provider_destination_id
        and operation.provider_destination_id=new.provider_destination_id
        and operation.operation_number > 1 and operation.status = 'RESERVED'
    ) into v_reviewed_recovery;
    if not v_reviewed_recovery then raise exception 'PAYOUT_DESTINATION_IMMUTABLE'; end if;
  end if;
  new.provider_response := coalesce(old.provider_response,'{}'::jsonb)||coalesce(new.provider_response,'{}'::jsonb);
  if v_old='PAID' and new.completed_at is null and not v_returned_evidenced then
    raise exception 'PAID_PAYOUT_COMPLETION_IMMUTABLE';
  end if;
  if v_old=v_new then return new; end if;
  if v_old='PENDING' and v_new in ('PROCESSING','PAID','FAILED','CANCELED','BLOCKED') then return new; end if;
  if v_old='PROCESSING' and v_new in ('PAID','FAILED','BLOCKED') then return new; end if;
  if v_old in ('PROCESSING','PAID') and v_new='FAILED' and v_returned_evidenced then return new; end if;
  if v_old in ('PROCESSING','PAID') and v_new='REVERSED' and v_reversal_evidenced then return new; end if;
  if v_old in ('FAILED','BLOCKED') and v_new='PROCESSING' then
    if not v_reviewed_recovery then
      select exists (
        select 1 from public.payout_destination_corrections correction
        join public.payout_provider_operations operation
          on operation.reviewed_correction_id = correction.id and operation.claim_id=correction.claim_id
        where correction.failed_payout_id::text=old.id::text
          and operation.operation_number > 1 and operation.status = 'RESERVED'
      ) into v_reviewed_recovery;
    end if;
    if not v_reviewed_recovery then
      select exists (
        select 1 from public.payout_claim_retry_authorizations retry
        join public.payout_claims claim on claim.id=retry.claim_id
        join public.payout_provider_operations operation
          on operation.reviewed_retry_id=retry.id and operation.claim_id=claim.id
        where claim.payout_id=old.id::text
          and retry.money_desk_request_id::text=new.provider_response->>'money_desk_request_id'
          and retry.id::text=new.provider_response->>'reviewed_retry_id'
          and operation.operation_number=retry.operation_number
          and operation.status='RESERVED'
          and claim.status='RESERVED'
          and operation.provider_destination_id=old.provider_destination_id
          and retry.provider_destination_id=old.provider_destination_id
          and operation.amount=old.amount
          and operation.currency=old.currency
      ) into v_reviewed_recovery;
    end if;
    if v_reviewed_recovery then return new; end if;
  end if;
  if v_old='BLOCKED' and v_new in ('FAILED','CANCELED') then return new; end if;
  raise exception 'ILLEGAL_PAYOUT_STATUS_TRANSITION:%->%',v_old,v_new;
end;
$function$;
revoke execute on function public.guard_payout_forward_status() from public, anon, authenticated;
grant execute on function public.guard_payout_forward_status() to service_role;

-- Preserve S1 source-transaction binding and include reviewed_retry_id in
-- the immutable provider-operation identity. No pre-provider bind is added.
create or replace function public.prevent_payout_provider_operation_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_transition_allowed boolean := false;
  v_source_bind boolean := false;
begin
  v_source_bind := old.provider_source_transaction_id is null
    and new.provider_source_transaction_id ~ '^ch_[A-Za-z0-9_-]+$'
    and old.provider = 'STRIPE'
    and old.status = 'PROVIDER_UNKNOWN'
    and current_setting('app.bind_payout_source_transaction', true) = 'on';

  if row(new.claim_id, new.operation_number, new.provider, new.provider_destination_id,
         new.currency, new.amount, new.provider_idempotency_key, new.reviewed_correction_id,
         new.reviewed_retry_id, new.money_desk_request_id)
    is distinct from
     row(old.claim_id, old.operation_number, old.provider, old.provider_destination_id,
         old.currency, old.amount, old.provider_idempotency_key, old.reviewed_correction_id,
         old.reviewed_retry_id, old.money_desk_request_id)
    or (new.provider_source_transaction_id is distinct from old.provider_source_transaction_id
      and not v_source_bind) then
    raise exception 'Provider operation identity cannot change';
  end if;

  if new.status = old.status then
    v_transition_allowed := true;
  else
    v_transition_allowed := case old.status
      when 'RESERVED' then new.status in ('PROVIDER_UNKNOWN','PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED')
      when 'PROVIDER_UNKNOWN' then new.status in ('PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED','LATE_SUCCEEDED')
      when 'PROVIDER_PENDING' then new.status in ('PROVIDER_PENDING','TRANSFERRED','FAILED_RETURNED','LATE_SUCCEEDED')
      when 'TRANSFERRED' then new.status in ('WITHDRAWN','LATE_SUCCEEDED')
      when 'WITHDRAWN' then new.status = 'LATE_SUCCEEDED'
      when 'FAILED_RETURNED' then new.status = 'LATE_SUCCEEDED'
      when 'LATE_SUCCEEDED' then false
      else false
    end;
  end if;
  if not v_transition_allowed then
    raise exception 'Invalid provider payout operation transition: % -> %', old.status, new.status;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.prevent_payout_provider_operation_identity_change() from public, anon, authenticated;
grant execute on function public.prevent_payout_provider_operation_identity_change() to service_role;

-- Preserve PAY-003/C2 refund evidence and aggregate checks, adding the
-- exact failed-journal reversal with a text bridge for Production UUID order IDs.
CREATE OR REPLACE FUNCTION public.reconcile_failed_order_payment_refund(p_payment_id uuid, p_provider_refund_id text, p_failure_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_payment public.order_payments%rowtype;
  v_refund public.order_payment_provider_refunds%rowtype;
  v_confirmed_total integer;
  v_confirmed_count integer;
  v_next_status public.order_payment_status;
  v_journal public.commercial_ledger_transactions%rowtype;
  v_reversal_id uuid;
  v_entries jsonb;
begin
  if p_payment_id is null
     or nullif(btrim(coalesce(p_provider_refund_id, '')), '') is null
     or nullif(btrim(coalesce(p_failure_evidence->>'failure_reason', '')), '') is null then
    raise exception 'REFUND_FAILURE_EVIDENCE_INVALID';
  end if;
  select * into v_payment from public.order_payments
  where id = p_payment_id for update;
  if v_payment.id is null then raise exception 'PAYMENT_NOT_FOUND'; end if;
  select * into v_refund from public.order_payment_provider_refunds
  where payment_id = v_payment.id and provider_refund_id = p_provider_refund_id
  for update;
  if v_refund.id is null or v_refund.status not in ('CONFIRMED', 'FAILED')
     or v_refund.provider is distinct from v_payment.provider then
    raise exception 'CONFIRMED_REFUND_ROW_NOT_FOUND';
  end if;

  -- Keep the provider position and the immutable ledger in one transaction.
  -- A failure must undo the exact refund journal, not its capture journal.
  select * into v_journal from public.commercial_ledger_transactions
  where payment_id = v_payment.id and transaction_kind = 'REFUND'
    and provider_reference = p_provider_refund_id
  for update;
  if v_journal.id is null or v_journal.original_amount <> v_refund.amount
     or v_journal.settlement_amount <> v_refund.amount
     or v_journal.original_currency <> v_payment.currency
     or v_journal.settlement_currency <> v_payment.currency
     or v_journal.order_id is distinct from v_payment.order_id::text then
    raise exception 'REFUND_FAILURE_JOURNAL_MISMATCH';
  end if;
  -- A later provider event can report the same failure under a new webhook ID.
  -- Accept only the exact reversal this function created; never post it twice.
  if v_refund.status = 'FAILED' then
    if (select count(*) from public.commercial_ledger_transactions
        where payment_id = v_payment.id and transaction_kind = 'REFUND'
          and provider_reference = p_provider_refund_id) <> 1
       or (select count(*) from public.commercial_ledger_transactions
        where transaction_kind = 'REVERSAL'
          and reversal_of_transaction_id = v_journal.id
          and idempotency_key = 'refund-failure-reversal:' || p_provider_refund_id
          and payment_id = v_payment.id
          and order_id is not distinct from v_payment.order_id::text
          and provider_reference = p_provider_refund_id
          and original_amount = v_journal.original_amount
          and settlement_amount = v_journal.settlement_amount) <> 1 then
      raise exception 'REFUND_FAILURE_JOURNAL_MISMATCH';
    end if;
    return to_jsonb(v_payment);
  end if;
  if (select count(*) from public.commercial_ledger_transactions
      where payment_id = v_payment.id and transaction_kind = 'REFUND'
        and provider_reference = p_provider_refund_id) <> 1
     or exists (select 1 from public.commercial_ledger_transactions
       where transaction_kind = 'REVERSAL'
         and reversal_of_transaction_id = v_journal.id) then
    raise exception 'REFUND_FAILURE_JOURNAL_MISMATCH';
  end if;
  select jsonb_agg(jsonb_build_object(
      'accountCode', e.account_code,
      'accountScope', e.account_scope,
      'direction', case when e.direction = 'DEBIT' then 'CREDIT' else 'DEBIT' end,
      'amount', e.amount,
      'currency', e.currency
    ) order by e.id) into v_entries
  from public.commercial_ledger_entries e
  where e.transaction_id = v_journal.id;
  if v_entries is null or jsonb_array_length(v_entries) < 2 then
    raise exception 'REFUND_FAILURE_JOURNAL_MISMATCH';
  end if;
  select public.post_commercial_ledger_transaction(
    p_idempotency_key => 'refund-failure-reversal:' || p_provider_refund_id,
    p_transaction_kind => 'REVERSAL',
    p_purpose => v_journal.purpose,
    p_order_id => v_journal.order_id,
    p_payment_id => v_payment.id,
    p_policy_version => v_journal.policy_version,
    p_pricing_version => v_journal.pricing_version,
    p_correlation_id => v_journal.correlation_id,
    p_provider_reference => p_provider_refund_id,
    p_entries => v_entries,
    p_metadata => jsonb_build_object('failed_refund_journal_id', v_journal.id),
    p_reversal_of_transaction_id => v_journal.id,
    p_actor_role => 'SYSTEM',
    p_original_currency => v_journal.original_currency,
    p_original_amount => v_journal.original_amount,
    p_settlement_currency => v_journal.settlement_currency,
    p_settlement_amount => v_journal.settlement_amount,
    p_fx_rate => v_journal.fx_rate,
    p_provider_fee_amount => 0
  ) into v_reversal_id;
  if v_reversal_id is null then raise exception 'REFUND_FAILURE_REVERSAL_MISSING'; end if;

  update public.order_payment_provider_refunds set
    status = 'FAILED',
    provider_response = coalesce(provider_response, '{}'::jsonb)
      || jsonb_build_object('failure_evidence', p_failure_evidence),
    updated_at = now()
  where id = v_refund.id;

  select coalesce(sum(amount), 0)::integer, count(*)::integer
  into v_confirmed_total, v_confirmed_count
  from public.order_payment_provider_refunds
  where payment_id = v_payment.id and status = 'CONFIRMED';
  if v_confirmed_total < 0 or v_confirmed_total > v_payment.amount then
    raise exception 'REFUND_FAILURE_AGGREGATE_INVALID';
  end if;
  v_next_status := case
    when v_confirmed_total = 0 then 'SUCCEEDED'::public.order_payment_status
    when v_confirmed_total = v_payment.amount then 'REFUNDED'::public.order_payment_status
    else 'PARTIAL_REFUND'::public.order_payment_status
  end;

  perform set_config('drape.payment_refund_failure', 'evidenced', true);
  update public.order_payments set
    refunded_amount = v_confirmed_total,
    partial_refund_count = v_confirmed_count,
    status = v_next_status,
    refunded_at = case when v_next_status = 'REFUNDED' then refunded_at else null end,
    provider_response = coalesce(provider_response, '{}'::jsonb)
      || jsonb_build_object('failed_refund_reconciliation', jsonb_build_object(
        'provider_refund_id', p_provider_refund_id,
        'amount_reversed', v_refund.amount,
        'evidence', p_failure_evidence
      ))
  where id = v_payment.id
  returning * into v_payment;
  perform set_config('drape.payment_refund_failure', '', true);
  return to_jsonb(v_payment);
exception when others then
  perform set_config('drape.payment_refund_failure', '', true);
  raise;
end;
$function$;
revoke execute on function public.reconcile_failed_order_payment_refund(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.reconcile_failed_order_payment_refund(uuid,text,jsonb) to service_role;
