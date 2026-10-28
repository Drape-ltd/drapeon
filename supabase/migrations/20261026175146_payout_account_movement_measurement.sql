-- Account-level payout movement evidence. This intentionally does not claim to
-- be the provider's current available balance: only the provider can report that.
-- Provider withdrawals can combine multiple earnings, so they are never joined
-- back to a specific payout/earning.

create or replace view public.payout_account_movement_summary
with (security_invoker = true)
as
with transfer_movement as (
  select
    p.tailor_profile_id,
    p.provider,
    p.provider_destination_id,
    p.currency,
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
  group by p.tailor_profile_id, p.provider, p.provider_destination_id, p.currency
),
latest_withdrawal_observations as (
  -- Webhooks store each Stripe event, not one mutable row per bank payout.
  -- Keep the latest state per provider payout ID to avoid summing created +
  -- in_transit + paid events as three separate withdrawals. If the provider
  -- payout ID is missing, retain the event as an unlinked observation and do
  -- not add its amount to any withdrawal total.
  select distinct on (
    e.provider,
    e.provider_destination_id,
    coalesce(e.provider_bank_payout_id, 'unlinked-event:' || e.provider_event_id),
    e.currency
  )
    e.id,
    e.provider,
    e.provider_destination_id,
    e.tailor_profile_id,
    e.provider_bank_payout_id,
    e.amount,
    e.currency,
    e.status,
    coalesce(
      e.occurred_at,
      case
        when e.payload->>'created' ~ '^[0-9]+([.][0-9]+)?$'
          then to_timestamp((e.payload->>'created')::double precision)
        else null
      end
    ) as occurred_at,
    e.processed_at,
    e.created_at
  from public.provider_payout_events e
  where e.payout_id is null
  order by
    e.provider,
    e.provider_destination_id,
    coalesce(e.provider_bank_payout_id, 'unlinked-event:' || e.provider_event_id),
    e.currency,
    coalesce(
      e.occurred_at,
      case
        when e.payload->>'created' ~ '^[0-9]+([.][0-9]+)?$'
          then to_timestamp((e.payload->>'created')::double precision)
        else null
      end
    ) desc nulls last,
    e.processed_at desc,
    e.created_at desc,
    e.id desc
),
withdrawal_movement as (
  select
    e.tailor_profile_id,
    e.provider,
    e.provider_destination_id,
    e.currency,
    count(*) filter (where e.provider_bank_payout_id is not null)::bigint as withdrawal_count,
    coalesce(sum(e.amount) filter (
      where e.provider_bank_payout_id is not null and e.status = 'PENDING'
    ), 0)::bigint as withdrawal_pending_minor,
    coalesce(sum(e.amount) filter (
      where e.provider_bank_payout_id is not null and e.status = 'IN_TRANSIT'
    ), 0)::bigint as withdrawal_in_transit_minor,
    coalesce(sum(e.amount) filter (
      where e.provider_bank_payout_id is not null and e.status = 'PAID'
    ), 0)::bigint as withdrawal_paid_minor,
    coalesce(sum(e.amount) filter (
      where e.provider_bank_payout_id is not null and e.status in ('FAILED', 'CANCELED')
    ), 0)::bigint as withdrawal_failed_or_canceled_minor,
    count(*) filter (
      where e.provider_bank_payout_id is not null
        and (e.status is null or e.status not in ('PENDING', 'IN_TRANSIT', 'PAID', 'FAILED', 'CANCELED'))
    )::bigint as withdrawal_status_unknown_count,
    count(*) filter (where e.provider_bank_payout_id is null)::bigint
      as withdrawal_reference_missing_count,
    max(coalesce(e.occurred_at, e.processed_at, e.created_at)) as latest_withdrawal_observed_at
  from latest_withdrawal_observations e
  group by e.tailor_profile_id, e.provider, e.provider_destination_id, e.currency
)
select
  coalesce(t.tailor_profile_id, w.tailor_profile_id) as tailor_profile_id,
  coalesce(t.provider, w.provider) as provider,
  coalesce(t.provider_destination_id, w.provider_destination_id) as provider_destination_id,
  coalesce(t.currency, w.currency) as currency,
  coalesce(t.payout_record_count, 0)::bigint as payout_record_count,
  coalesce(t.transfer_not_started_minor, 0)::bigint as transfer_not_started_minor,
  coalesce(t.transfer_processing_minor, 0)::bigint as transfer_processing_minor,
  coalesce(t.transferred_to_provider_balance_minor, 0)::bigint as transferred_to_provider_balance_minor,
  coalesce(t.transferred_directly_to_bank_minor, 0)::bigint as transferred_directly_to_bank_minor,
  coalesce(t.transfer_failed_minor, 0)::bigint as transfer_failed_minor,
  coalesce(t.transfer_reversed_minor, 0)::bigint as transfer_reversed_minor,
  coalesce(t.transfer_status_unknown_count, 0)::bigint as transfer_status_unknown_count,
  coalesce(w.withdrawal_count, 0)::bigint as withdrawal_count,
  coalesce(w.withdrawal_pending_minor, 0)::bigint as withdrawal_pending_minor,
  coalesce(w.withdrawal_in_transit_minor, 0)::bigint as withdrawal_in_transit_minor,
  coalesce(w.withdrawal_paid_minor, 0)::bigint as withdrawal_paid_minor,
  coalesce(w.withdrawal_failed_or_canceled_minor, 0)::bigint as withdrawal_failed_or_canceled_minor,
  coalesce(w.withdrawal_status_unknown_count, 0)::bigint as withdrawal_status_unknown_count,
  coalesce(w.withdrawal_reference_missing_count, 0)::bigint as withdrawal_reference_missing_count,
  t.latest_transfer_recorded_at,
  w.latest_withdrawal_observed_at,
  case
    when coalesce(t.tailor_profile_id, w.tailor_profile_id) is null
      or coalesce(t.provider_destination_id, w.provider_destination_id) is null
      or coalesce(t.currency, w.currency) is null then 'INCOMPLETE_ACCOUNT_LINK'
    else 'ACCOUNT_LINKED'
  end as account_link_status
from transfer_movement t
full outer join withdrawal_movement w
  on w.tailor_profile_id is not distinct from t.tailor_profile_id
  and w.provider = t.provider
  and w.provider_destination_id is not distinct from t.provider_destination_id
  and w.currency is not distinct from t.currency;

revoke all on public.payout_account_movement_summary from public, anon, authenticated;
grant select on public.payout_account_movement_summary to service_role;

comment on view public.payout_account_movement_summary is
  'Measurement-only account-level transfer and withdrawal observations grouped by tailor/provider/destination/currency. Does not represent the provider-reported current balance, transferable funds, or per-order withdrawal allocation. Withdrawal statuses are deduplicated by provider bank payout ID; observations without one are count-only.';
