-- Once a payout claim points to its journal, neither a retry nor a privileged
-- caller may rewrite or erase that receipt.
create function public.prevent_tip_payout_ledger_receipt_rewrite()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if old.payout_ledger_transaction_id is not null
    and new.payout_ledger_transaction_id is distinct from
      old.payout_ledger_transaction_id then
    raise exception 'Recorded tip payout journal cannot be rewritten';
  end if;
  return new;
end $$;

create trigger tip_payout_ledger_receipt_immutable
  before update of payout_ledger_transaction_id
  on public.tip_money_operation_claims
  for each row execute function public.prevent_tip_payout_ledger_receipt_rewrite();

revoke execute on function public.prevent_tip_payout_ledger_receipt_rewrite()
  from public,anon,authenticated;
