-- Roll back only the two additive indexes from this migration.
drop index if exists public.payout_attempts_claim_operation_idx;
drop index if exists public.payout_provider_operations_correction_idx;
