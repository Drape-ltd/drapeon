-- Roll back the additive snapshot-correction schema only. Run after the
-- higher-version C2 RPC, trigger, guard, and index rollbacks.
do $rollback$
begin
  if exists (
    select 1 from public.payout_destination_corrections where claim_id is not null
  ) then
    raise exception 'Cannot roll back after a snapshot payout-destination correction has been recorded';
  end if;
  if exists (
    select 1 from public.payout_destination_corrections
    group by failed_payout_id having count(*) > 1
  ) then
    raise exception 'Cannot restore the legacy one-correction-per-payout constraint';
  end if;
end
$rollback$;

drop index if exists public.payout_destination_corrections_claim_operation_unique;
drop index if exists public.payout_destination_corrections_failed_payout_idx;
drop index if exists public.payout_destination_corrections_previous_destination_idx;
drop index if exists public.payout_destination_corrections_replacement_destination_idx;

alter table public.payout_destination_corrections
  drop constraint if exists payout_destination_corrections_snapshot_identity_check,
  add constraint payout_destination_corrections_failed_payout_id_key unique (failed_payout_id),
  drop column if exists correction_transaction_id,
  drop column if exists replacement_destination_id,
  drop column if exists previous_destination_id,
  drop column if exists claim_id;

-- operation_number predates this migration in Dev; preserve it.
