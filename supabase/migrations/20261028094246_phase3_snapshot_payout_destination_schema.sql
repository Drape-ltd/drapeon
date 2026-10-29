-- Audited destination supersession for accepted snapshot tranche claims.
-- The accepted earning and original claim remain immutable. A numbered
-- replacement provider operation is allowed only after final failure and
-- confirmed return of funds to the same provider.

alter table public.payout_destination_corrections
  drop constraint if exists payout_destination_corrections_failed_payout_id_key;

alter table public.payout_destination_corrections
  add column if not exists claim_id uuid references public.payout_claims(id) on delete restrict,
  add column if not exists operation_number integer,
  add column if not exists previous_destination_id uuid references public.payout_destinations(id) on delete restrict,
  add column if not exists replacement_destination_id uuid references public.payout_destinations(id) on delete restrict,
  add column if not exists correction_transaction_id bigint;

alter table public.payout_destination_corrections
  drop constraint if exists payout_destination_corrections_snapshot_identity_check;
alter table public.payout_destination_corrections
  add constraint payout_destination_corrections_snapshot_identity_check
  check (
    -- Legacy reviewed corrections may already use operation_number in older
    -- environments. Only the new snapshot identity fields distinguish them.
    (claim_id is null and (operation_number is null or operation_number between 1 and 3)
      and previous_destination_id is null and replacement_destination_id is null
      and correction_transaction_id is null)
    or
    (claim_id is not null and operation_number is not null and operation_number between 2 and 3
      and previous_destination_id is not null
      and replacement_destination_id is not null
      and previous_destination_id <> replacement_destination_id
      and correction_transaction_id is not null)
  );

create unique index if not exists payout_destination_corrections_claim_operation_unique
  on public.payout_destination_corrections(claim_id, operation_number)
  where claim_id is not null;
create index if not exists payout_destination_corrections_failed_payout_idx
  on public.payout_destination_corrections(failed_payout_id);
