-- Roll back only after all DRAPEON_FUNDED_REFUND entries have been migrated or
-- explicitly reconciled. This refuses to remove a live account code.
do $$
begin
  if exists (
    select 1 from public.commercial_ledger_entries
    where account_code = 'DRAPEON_FUNDED_REFUND'
  ) then
    raise exception 'Cannot remove DRAPEON_FUNDED_REFUND while ledger entries use it.';
  end if;
end;
$$;

alter table public.commercial_ledger_entries
  drop constraint if exists commercial_ledger_entries_account_code_check;

alter table public.commercial_ledger_entries
  add constraint commercial_ledger_entries_account_code_check check (account_code in (
    'CUSTOMER_RECEIVABLE','PROVIDER_CLEARING','PROVIDER_FEE_EXPENSE',
    'TAILOR_ENTITLEMENT','TAILOR_ELIGIBLE','TAILOR_RELEASED',
    'CONSULTATION_ENTITLEMENT','MATERIAL_ADVANCE_LIABILITY',
    'FULFILLMENT_LIABILITY','TAX_LIABILITY','IMPORT_TAX_LIABILITY',
    'DUTY_LIABILITY','TIP_LIABILITY','DRAPEON_SUBSIDY_EXPENSE','DRAPEON_REVENUE'
  ));
