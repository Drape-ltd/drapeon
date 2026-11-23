alter table public.payout_destinations
  drop constraint if exists payout_destinations_bachs_onboarding_counts_check,
  drop column if exists provider_onboarding_due_count,
  drop column if exists provider_onboarding_pending_count,
  drop column if exists provider_onboarding_checked_at;
