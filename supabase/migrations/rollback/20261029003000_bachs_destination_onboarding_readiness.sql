drop trigger if exists bachs_onboarding_review_readiness_guard on public.payout_destinations;
drop function if exists private.guard_bachs_onboarding_review_readiness();
alter table public.payout_destinations
  drop constraint if exists payout_destinations_bachs_active_onboarding_ready;
