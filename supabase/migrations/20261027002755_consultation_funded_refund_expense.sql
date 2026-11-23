-- Separate post-payout consultation refunds from the tailor's already-released
-- earning. The dedicated account preserves the original earning and makes this
-- Drapeon-funded expense visible to reserve/reconciliation reporting.

alter table public.commercial_ledger_entries
  drop constraint if exists commercial_ledger_entries_account_code_check;

alter table public.commercial_ledger_entries
  add constraint commercial_ledger_entries_account_code_check check (account_code in (
    'CUSTOMER_RECEIVABLE','PROVIDER_CLEARING','PROVIDER_FEE_EXPENSE',
    'TAILOR_ENTITLEMENT','TAILOR_ELIGIBLE','TAILOR_RELEASED',
    'CONSULTATION_ENTITLEMENT','MATERIAL_ADVANCE_LIABILITY',
    'FULFILLMENT_LIABILITY','TAX_LIABILITY','IMPORT_TAX_LIABILITY',
    'DUTY_LIABILITY','TIP_LIABILITY','DRAPEON_SUBSIDY_EXPENSE',
    'DRAPEON_FUNDED_REFUND','DRAPEON_REVENUE'
  ));

comment on constraint commercial_ledger_entries_account_code_check on public.commercial_ledger_entries is
  'Supported commercial ledger accounts, including the separate Drapeon-funded post-payout consultation refund expense.';
