drop index if exists public.tailor_claim_bootstrap_verified_provider_subject_idx;
create unique index tailor_claim_bootstrap_verified_provider_subject_idx
  on public.tailor_claim_bootstrap_sessions(provider, provider_subject)
  where provider_subject is not null and status in ('PREPARING', 'ACTIVE');

comment on index public.tailor_claim_bootstrap_verified_provider_subject_idx is
  'Prevents concurrent active claims for one provider subject while allowing a failed, expired, or superseded proof to retry.';
