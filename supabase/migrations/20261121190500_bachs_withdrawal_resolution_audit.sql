-- Preserve the reviewer and resolution decision in the append-only claim event.
alter table public.bachs_withdrawal_fee_events
  add column if not exists resolution_code text,
  add column if not exists resolution_actor text,
  add column if not exists resolved_at timestamptz,
  add column if not exists correction_ledger_transaction_id uuid;

create or replace function public.audit_bachs_withdrawal_fee_claim()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.bachs_withdrawal_fee_events(
    claim_id,old_status,new_status,topup_transfer_id,payout_id,
    sweep_transfer_id,actual_fee_minor,fee_ledger_transaction_id,
    resolution_code,resolution_actor,resolved_at,correction_ledger_transaction_id
  ) values (
    new.id,case when tg_op = 'UPDATE' then old.status else null end,
    new.status,new.topup_transfer_id,new.payout_id,new.sweep_transfer_id,
    new.actual_fee_minor,new.fee_ledger_transaction_id,
    new.resolution_code,new.resolution_actor,new.resolved_at,
    new.correction_ledger_transaction_id
  );
  return new;
end;
$$;
revoke all on function public.audit_bachs_withdrawal_fee_claim() from public, anon, authenticated, service_role;
