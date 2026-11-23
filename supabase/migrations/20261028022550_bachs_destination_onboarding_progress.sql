-- Aggregate-only Bachs onboarding progress. Never store KYC field values,
-- document identifiers, or uploaded verification material in Drapeon.
alter table public.payout_destinations
  add column if not exists provider_onboarding_due_count smallint not null default 0,
  add column if not exists provider_onboarding_pending_count smallint not null default 0,
  add column if not exists provider_onboarding_checked_at timestamptz;

alter table public.payout_destinations
  drop constraint if exists payout_destinations_bachs_onboarding_counts_check;
alter table public.payout_destinations
  add constraint payout_destinations_bachs_onboarding_counts_check
  check (
    provider_onboarding_due_count >= 0
    and provider_onboarding_pending_count >= 0
    and (provider = 'BACHS' or (
      provider_onboarding_due_count = 0
      and provider_onboarding_pending_count = 0
      and provider_onboarding_checked_at is null
    ))
  );

comment on column public.payout_destinations.provider_onboarding_due_count is
  'Aggregate count of Bachs currently/past-due onboarding requirements. Does not store KYC values or documents.';
comment on column public.payout_destinations.provider_onboarding_pending_count is
  'Aggregate count of Bachs requirements pending verification. Does not store KYC values or documents.';
