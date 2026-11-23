-- Do not erase an unresolved identity conflict or its financial evidence.
do $$
begin
  if exists (select 1 from public.tip_money_operation_claims
    where status='BLOCKED_IDENTITY') then
    raise exception 'Resolve blocked tip payout claims before rollback';
  end if;
end;
$$;
drop function if exists public.block_tip_payout_identity_conflict(uuid,text,jsonb);
drop trigger if exists tip_money_blocked_identity_guard on public.tip_money_operation_claims;
drop function if exists public.prevent_unreviewed_blocked_tip_claim_transition();
alter table public.tip_money_operation_claims
  drop constraint tip_money_operation_claims_status_check;
alter table public.tip_money_operation_claims
  add constraint tip_money_operation_claims_status_check check (status in (
    'RESERVED','PROVIDER_UNKNOWN','PROVIDER_PENDING','SUCCEEDED','FAILED_RECONCILED'
  ));
