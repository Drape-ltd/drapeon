-- Capabilities alone do not prove that a Bachs recipient has completed the
-- requirements needed to withdraw. Fail closed before review and activation.
alter table public.payout_destinations
  add constraint payout_destinations_bachs_active_onboarding_ready
  check (
    provider <> 'BACHS' or not active or (
      provider_onboarding_checked_at is not null
      and provider_onboarding_due_count = 0
      and provider_onboarding_pending_count = 0
    )
  ) not valid;

alter table public.payout_destinations
  validate constraint payout_destinations_bachs_active_onboarding_ready;

create function private.guard_bachs_onboarding_review_readiness()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.provider = 'BACHS'
    and new.first_withdrawal_review_status = 'CLEARED'
    and (tg_op = 'INSERT' or old.first_withdrawal_review_status is distinct from 'CLEARED')
    and (
      new.provider_onboarding_checked_at is null
      or new.provider_onboarding_checked_at < now() - interval '15 minutes'
      or new.provider_onboarding_checked_at > now() + interval '1 minute'
      or new.provider_onboarding_due_count <> 0
      or new.provider_onboarding_pending_count <> 0
    ) then
    raise exception using
      errcode = '23514',
      constraint = 'bachs_first_release_requires_current_onboarding',
      message = 'Refresh Bachs onboarding and complete outstanding requirements before review';
  end if;
  return new;
end
$function$;

revoke all on function private.guard_bachs_onboarding_review_readiness() from public, anon, authenticated, service_role;

create trigger bachs_onboarding_review_readiness_guard
before insert or update on public.payout_destinations
for each row execute function private.guard_bachs_onboarding_review_readiness();
