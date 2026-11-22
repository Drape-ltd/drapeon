-- Forward-only review resolution for sandbox withdrawal fee claims.
alter table public.bachs_withdrawal_fee_claims
  add column if not exists resolution_code text,
  add column if not exists resolution_actor text,
  add column if not exists resolved_at timestamptz,
  add column if not exists correction_ledger_transaction_id uuid references public.commercial_ledger_transactions(id) on delete restrict;

alter table public.bachs_withdrawal_fee_claims
  drop constraint if exists bachs_withdrawal_fee_claims_status_check;
alter table public.bachs_withdrawal_fee_claims
  add constraint bachs_withdrawal_fee_claims_status_check check (status in (
    'RESERVED','TOPUP_SUBMITTED','TOPUP_PAID','PAYOUT_SUBMITTED',
    'FEE_PENDING','FEE_RECORDED','SWEEP_SUBMITTED','COMPLETE','REVIEW','RESOLVED'
  ));
alter table public.bachs_withdrawal_fee_claims
  add constraint bachs_withdrawal_review_reason_check check (
    review_reason is null or review_reason in (
      'CONNECTED_BALANCE_CHANGED_BEFORE_PAYOUT','PAYOUT_FAILED',
      'PAYOUT_FEE_OUTSIDE_RESERVE','PAYOUT_DEBIT_MISMATCH',
      'CONNECTED_BALANCE_CHANGED_BEFORE_SWEEP'
    )
  );
alter table public.bachs_withdrawal_fee_claims
  add constraint bachs_withdrawal_resolution_check check (
    (status = 'RESOLVED' and resolution_code in (
      'BALANCE_RECONCILED','FEE_PLATFORM_CONFIRMED',
      'FEE_NOT_CHARGED_REVERSED','PAYOUT_FAILED_CLOSED'
    ) and length(trim(resolution_actor)) > 0 and resolved_at is not null)
    or (status <> 'RESOLVED' and resolution_code is null and resolution_actor is null
      and resolved_at is null and correction_ledger_transaction_id is null)
  );
alter table public.bachs_withdrawal_fee_claims
  add constraint bachs_withdrawal_correction_check check (
    resolution_code is distinct from 'FEE_NOT_CHARGED_REVERSED'
    or (fee_ledger_transaction_id is not null and correction_ledger_transaction_id is not null)
  );

drop index if exists public.bachs_withdrawal_fee_claims_one_open_destination_idx;
create unique index bachs_withdrawal_fee_claims_one_open_destination_idx
  on public.bachs_withdrawal_fee_claims(payout_destination_id)
  where status not in ('COMPLETE','RESOLVED');

create or replace function public.guard_bachs_withdrawal_fee_claim()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Bachs withdrawal claims are append-only.';
  end if;
  if row(old.id,old.request_key,old.payout_destination_id,old.provider_account_id,
    old.provider_bank_destination_id,old.currency,old.withdrawal_amount_minor,
    old.reserve_amount_minor,old.created_at)
    is distinct from
    row(new.id,new.request_key,new.payout_destination_id,new.provider_account_id,
    new.provider_bank_destination_id,new.currency,new.withdrawal_amount_minor,
    new.reserve_amount_minor,new.created_at) then
    raise exception 'Bachs withdrawal claim identity is immutable.';
  end if;
  if (old.topup_transfer_id is not null and new.topup_transfer_id is distinct from old.topup_transfer_id)
    or (old.payout_id is not null and new.payout_id is distinct from old.payout_id)
    or (old.sweep_transfer_id is not null and new.sweep_transfer_id is distinct from old.sweep_transfer_id)
    or (old.actual_fee_minor is not null and new.actual_fee_minor is distinct from old.actual_fee_minor)
    or (old.fee_ledger_transaction_id is not null and new.fee_ledger_transaction_id is distinct from old.fee_ledger_transaction_id)
    or (old.correction_ledger_transaction_id is not null and new.correction_ledger_transaction_id is distinct from old.correction_ledger_transaction_id) then
    raise exception 'Bachs withdrawal provider and ledger receipts are immutable.';
  end if;
  if old.status in ('COMPLETE','RESOLVED') then
    raise exception 'Bachs withdrawal terminal claim is immutable.';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'RESERVED' and new.status in ('TOPUP_SUBMITTED','REVIEW')) or
    (old.status = 'TOPUP_SUBMITTED' and new.status in ('TOPUP_PAID','REVIEW')) or
    (old.status = 'TOPUP_PAID' and new.status in ('PAYOUT_SUBMITTED','REVIEW')) or
    (old.status = 'PAYOUT_SUBMITTED' and new.status in ('FEE_PENDING','REVIEW')) or
    (old.status = 'FEE_PENDING' and new.status in ('FEE_RECORDED','REVIEW')) or
    (old.status = 'FEE_RECORDED' and new.status in ('SWEEP_SUBMITTED','COMPLETE','REVIEW')) or
    (old.status = 'SWEEP_SUBMITTED' and new.status in ('COMPLETE','REVIEW')) or
    (old.status = 'REVIEW' and new.status = 'RESOLVED'
      and current_setting('app.bachs_withdrawal_resolution',true) = 'true')
  ) then
    raise exception 'Bachs withdrawal status cannot move backward or bypass review.';
  end if;
  if new.status = 'RESOLVED' and current_setting('app.bachs_withdrawal_resolution',true) is distinct from 'true' then
    raise exception 'Use the reviewed withdrawal resolution RPC.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.guard_bachs_withdrawal_fee_claim() from public, anon, authenticated, service_role;

create or replace function public.resolve_bachs_withdrawal_fee_claim(
  p_claim_id uuid, p_resolution_code text, p_actor text,
  p_correction_ledger_transaction_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_claim public.bachs_withdrawal_fee_claims%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.';
  end if;
  select * into v_claim from public.bachs_withdrawal_fee_claims where id = p_claim_id for update;
  if not found or v_claim.status <> 'REVIEW' then
    raise exception 'Withdrawal claim is not in review.';
  end if;
  if p_resolution_code not in ('BALANCE_RECONCILED','FEE_PLATFORM_CONFIRMED',
      'FEE_NOT_CHARGED_REVERSED','PAYOUT_FAILED_CLOSED')
    or nullif(trim(p_actor),'') is null then
    raise exception 'A reviewed resolution code and actor are required.';
  end if;
  if p_resolution_code = 'FEE_NOT_CHARGED_REVERSED' and
    (v_claim.fee_ledger_transaction_id is null or p_correction_ledger_transaction_id is null) then
    raise exception 'A posted fee requires a forward correction ledger transaction.';
  end if;
  perform set_config('app.bachs_withdrawal_resolution','true',true);
  update public.bachs_withdrawal_fee_claims set status = 'RESOLVED',
    resolution_code = p_resolution_code, resolution_actor = p_actor,
    resolved_at = now(), correction_ledger_transaction_id = p_correction_ledger_transaction_id
    where id = p_claim_id;
  perform set_config('app.bachs_withdrawal_resolution','',true);
  return p_claim_id;
end;
$$;
revoke all on function public.resolve_bachs_withdrawal_fee_claim(uuid,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_bachs_withdrawal_fee_claim(uuid,text,text,uuid) to service_role;
