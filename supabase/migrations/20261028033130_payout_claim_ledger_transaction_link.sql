-- Keep the commercial capture ledger reference on order_tips separate from the
-- later payout ledger reference. One payout claim may own only one payout row.
alter table public.payout_claims
  add column if not exists payout_ledger_transaction_id uuid
  references public.commercial_ledger_transactions(id) on delete restrict;

create unique index if not exists payout_claims_payout_id_unique
  on public.payout_claims(payout_id)
  where payout_id is not null;

create unique index if not exists payout_claims_payout_ledger_transaction_unique
  on public.payout_claims(payout_ledger_transaction_id)
  where payout_ledger_transaction_id is not null;

create or replace function public.prevent_payout_claim_ledger_rewrite()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.payout_ledger_transaction_id is not null
    and new.payout_ledger_transaction_id is distinct from old.payout_ledger_transaction_id then
    raise exception 'Payout claim ledger transaction cannot be replaced';
  end if;
  return new;
end;
$$;

drop trigger if exists payout_claim_ledger_immutable on public.payout_claims;
create trigger payout_claim_ledger_immutable
  before update of payout_ledger_transaction_id on public.payout_claims
  for each row execute function public.prevent_payout_claim_ledger_rewrite();

revoke all on function public.prevent_payout_claim_ledger_rewrite()
  from public, anon, authenticated;
