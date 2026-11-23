-- Record when a provider-confirmed earning transfer was first observed by
-- Drapeon, then expose account/purpose transfer-age buckets for Ops measurement.
-- This is not a dispute-window calculation, live balance, reserve, or cap.

alter table public.payouts
  add column if not exists provider_transfer_confirmed_observed_at timestamptz;

-- Backfill only from an existing explicit completion timestamp. Do not guess
-- from processed_at/initiated_at: those may describe request creation rather
-- than provider confirmation.
update public.payouts
set provider_transfer_confirmed_observed_at = completed_at
where provider_transfer_confirmed_observed_at is null
  and provider_transfer_status in ('AVAILABLE_IN_PROVIDER_BALANCE', 'PAID_TO_BANK')
  and completed_at is not null;

create or replace function private.capture_payout_transfer_confirmation_observation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    if old.provider_transfer_confirmed_observed_at is not null then
      -- Preserve the first local confirmation even if later provider events mark
      -- the transfer returned/reversed or update unrelated payout fields.
      new.provider_transfer_confirmed_observed_at := old.provider_transfer_confirmed_observed_at;
      return new;
    end if;
  end if;

  if new.provider_transfer_status in ('AVAILABLE_IN_PROVIDER_BALANCE', 'PAID_TO_BANK') then
    new.provider_transfer_confirmed_observed_at := coalesce(new.completed_at, statement_timestamp());
  else
    new.provider_transfer_confirmed_observed_at := null;
  end if;

  return new;
end
$function$;

revoke all on function private.capture_payout_transfer_confirmation_observation()
  from public, anon, authenticated;
grant execute on function private.capture_payout_transfer_confirmation_observation()
  to service_role;

create trigger payouts_capture_transfer_confirmation_observation
before insert or update of provider_transfer_status, completed_at, provider_transfer_confirmed_observed_at
on public.payouts
for each row execute function private.capture_payout_transfer_confirmation_observation();

create or replace view public.payout_account_purpose_movement_summary
with (security_invoker = true)
as
select
  p.tailor_profile_id,
  p.provider,
  p.provider_destination_id,
  p.currency,
  coalesce(p.payout_purpose, 'UNKNOWN') as payout_purpose,
  count(*)::bigint as payout_record_count,
  coalesce(sum(p.amount) filter (where p.provider_transfer_status = 'NOT_STARTED'), 0)::bigint
    as transfer_not_started_minor,
  coalesce(sum(p.amount) filter (where p.provider_transfer_status = 'PROCESSING'), 0)::bigint
    as transfer_processing_minor,
  coalesce(sum(p.amount) filter (where p.provider_transfer_status = 'AVAILABLE_IN_PROVIDER_BALANCE'), 0)::bigint
    as transferred_to_provider_balance_minor,
  coalesce(sum(p.amount) filter (where p.provider_transfer_status = 'PAID_TO_BANK'), 0)::bigint
    as transferred_directly_to_bank_minor,
  coalesce(sum(p.amount) filter (where p.provider_transfer_status = 'FAILED'), 0)::bigint
    as transfer_failed_minor,
  coalesce(sum(p.amount) filter (where p.provider_transfer_status = 'REVERSED'), 0)::bigint
    as transfer_reversed_minor,
  count(*) filter (
    where p.provider_transfer_status not in (
      'NOT_STARTED', 'PROCESSING', 'AVAILABLE_IN_PROVIDER_BALANCE',
      'PAID_TO_BANK', 'FAILED', 'REVERSED'
    ) or p.provider_transfer_status is null
  )::bigint as transfer_status_unknown_count,
  max(coalesce(p.processed_at, p.initiated_at)) as latest_transfer_recorded_at,
  coalesce(sum(p.amount) filter (
    where p.provider_transfer_status in ('AVAILABLE_IN_PROVIDER_BALANCE', 'PAID_TO_BANK')
      and p.provider_transfer_confirmed_observed_at >= statement_timestamp() - interval '3 days'
  ), 0)::bigint as confirmed_transfer_0_to_3d_minor,
  coalesce(sum(p.amount) filter (
    where p.provider_transfer_status in ('AVAILABLE_IN_PROVIDER_BALANCE', 'PAID_TO_BANK')
      and p.provider_transfer_confirmed_observed_at < statement_timestamp() - interval '3 days'
      and p.provider_transfer_confirmed_observed_at >= statement_timestamp() - interval '14 days'
  ), 0)::bigint as confirmed_transfer_4_to_14d_minor,
  coalesce(sum(p.amount) filter (
    where p.provider_transfer_status in ('AVAILABLE_IN_PROVIDER_BALANCE', 'PAID_TO_BANK')
      and p.provider_transfer_confirmed_observed_at < statement_timestamp() - interval '14 days'
      and p.provider_transfer_confirmed_observed_at >= statement_timestamp() - interval '120 days'
  ), 0)::bigint as confirmed_transfer_15_to_120d_minor,
  coalesce(sum(p.amount) filter (
    where p.provider_transfer_status in ('AVAILABLE_IN_PROVIDER_BALANCE', 'PAID_TO_BANK')
      and p.provider_transfer_confirmed_observed_at < statement_timestamp() - interval '120 days'
  ), 0)::bigint as confirmed_transfer_over_120d_minor,
  count(*) filter (
    where p.provider_transfer_status in ('AVAILABLE_IN_PROVIDER_BALANCE', 'PAID_TO_BANK')
      and p.provider_transfer_confirmed_observed_at is null
  )::bigint as confirmed_transfer_age_unknown_count,
  coalesce(sum(p.amount) filter (
    where p.provider_transfer_status in ('AVAILABLE_IN_PROVIDER_BALANCE', 'PAID_TO_BANK')
      and p.provider_transfer_confirmed_observed_at is null
  ), 0)::bigint as confirmed_transfer_age_unknown_minor
from public.payouts p
group by
  p.tailor_profile_id,
  p.provider,
  p.provider_destination_id,
  p.currency,
  coalesce(p.payout_purpose, 'UNKNOWN');

revoke all on public.payout_account_purpose_movement_summary
  from public, anon, authenticated, service_role;
grant select on public.payout_account_purpose_movement_summary to service_role;

comment on column public.payouts.provider_transfer_confirmed_observed_at is
  'First local observation of provider-confirmed transfer to provider balance/direct bank. Not necessarily provider event time or charge time; NULL means historical confirmation age is unknown.';

comment on view public.payout_account_purpose_movement_summary is
  'Ops-only gross payout transfer movements grouped by account and purpose, with age buckets based on Drapeon first observing provider confirmation. Not charge/dispute age, current provider balance, reserve exposure, refund allocation, or withdrawal attribution.';
