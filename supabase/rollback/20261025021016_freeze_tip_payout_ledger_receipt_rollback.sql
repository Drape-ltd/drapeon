-- Remove only the immutable payout-ledger receipt guard introduced by this
-- migration. Run after code relying on this freeze is disabled and only when
-- the trigger/function definitions still match this migration.
do $$
declare
  v_definition text;
begin
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.tip_money_operation_claims'::regclass
      and t.tgname='tip_payout_ledger_receipt_immutable'
      and not t.tgisinternal
  ) then
    raise exception 'Expected tip payout receipt trigger is missing; rollback refused';
  end if;
  select pg_get_functiondef(
    'public.prevent_tip_payout_ledger_receipt_rewrite()'::regprocedure
  ) into v_definition;
  if v_definition is null
    or position('Recorded tip payout journal cannot be rewritten' in v_definition)=0 then
    raise exception 'Unexpected tip payout receipt guard; rollback refused';
  end if;
end;
$$;

drop trigger tip_payout_ledger_receipt_immutable
  on public.tip_money_operation_claims;
drop function public.prevent_tip_payout_ledger_receipt_rewrite();
