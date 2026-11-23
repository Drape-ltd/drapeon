-- Restore the two claim FK indexes present in Dev but missing from the
-- replayable migration source. Both are partial indexes on nullable links.
create index if not exists payout_attempts_claim_operation_idx
  on public.payout_attempts (claim_operation_id, started_at desc)
  where claim_operation_id is not null;

create index if not exists payout_provider_operations_correction_idx
  on public.payout_provider_operations (reviewed_correction_id)
  where reviewed_correction_id is not null;
