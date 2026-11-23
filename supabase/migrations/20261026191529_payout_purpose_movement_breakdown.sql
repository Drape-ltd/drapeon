-- Add a purpose dimension to the existing account-level movement evidence.
-- This is transfer history only, not a balance or reserve/exposure calculation.
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
  max(coalesce(p.processed_at, p.initiated_at)) as latest_transfer_recorded_at
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

comment on view public.payout_account_purpose_movement_summary is
  'Measurement-only gross payout-transfer observations grouped by tailor/provider/destination/currency/purpose. It is not current provider balance, reserve exposure, refund allocation, or bank-withdrawal attribution.';
