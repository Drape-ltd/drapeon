-- Read-only Dev postflight for the provider-signed sandbox collection that
-- arrived after the controlled proof expired. This is an evidence fixture,
-- not a migration or a Production test.
do $proof$
begin
  if not exists (select 1 from public.ops_runtime_configuration
    where singleton and environment='DEVELOPMENT'
      and project_ref='pqptfuqogvrajozfsqzi') then
    raise exception 'PHASE4_LATE_COLLECTION_DEV_ONLY';
  end if;
  if not exists (select 1 from public.phase4_payment_proofs
    where id='34f0a724-7f96-4580-b831-8ec2369667e6'
      and state='EXPIRED' and closed_at is not null) then
    raise exception 'PHASE4_LATE_PROOF_NOT_EXPIRED';
  end if;
  if not exists (select 1 from public.payment_webhook_events
    where id='fe5ceac9-77bf-45a8-bf13-651c2172b3f5'
      and provider_event_id='evt_88240060661e80cb97dc8857d5ff10c4'
      and signature_valid is true and processing_status='PROCESSED'
      and processing_result='phase4_proof_late_collection_refund_review') then
    raise exception 'PHASE4_LATE_SIGNED_WEBHOOK_NOT_PROCESSED';
  end if;
  if not exists (select 1 from public.order_payments
    where id='7cf673ea-1886-4804-b72d-00a45159b694'
      and order_id='f4270000-0000-4000-8000-000000000001'
      and status='SUCCEEDED') or
     (select count(*) from public.commercial_ledger_transactions
      where order_id='f4270000-0000-4000-8000-000000000001'
        and transaction_kind='CAPTURE')<>1 then
    raise exception 'PHASE4_LATE_MONEY_NOT_RECORDED_EXACTLY_ONCE';
  end if;
  if not exists (select 1 from public.orders
    where id='f4270000-0000-4000-8000-000000000001'
      and stage='PAYMENT_PENDING') or
     exists (select 1 from public.payout_claims
       where order_id='f4270000-0000-4000-8000-000000000001') or
     exists (select 1 from public.order_settlement_tranches
       where order_id='f4270000-0000-4000-8000-000000000001'
         and status<>'LOCKED') then
    raise exception 'PHASE4_LATE_ORDER_OR_PAYOUT_ADVANCED';
  end if;
  if not exists (select 1 from public.ops_issues
    where id='92bd275b-ffdf-456c-b232-2e163fd39013'
      and status='OPEN') or
     exists (select 1 from public.payment_routes where status='ENABLED') then
    raise exception 'PHASE4_LATE_REVIEW_OR_ROUTE_MISSING';
  end if;
end $proof$;
