-- The original provider_destination_ref is an onboarding identity, not a
-- mutable current-bank pointer. No bank summary was stored with that ref;
-- legacy rows keep nullable summary fields until a future provider refresh.
insert into public.bachs_withdrawal_destinations (
  payout_destination_id, provider_destination_ref, status,
  requested_at, confirmed_at, decision_reason,
  provider_default_status, provider_default_synced_at, ops_review_status
)
select d.id, d.provider_destination_ref, 'CURRENT', d.created_at,
       coalesce(d.capability_checked_at, d.created_at), 'ORIGINAL_ONBOARDING_BACKFILL',
       'SYNCED', coalesce(d.capability_checked_at, d.created_at), 'CLEARED'
from public.payout_destinations d
where d.provider = 'BACHS' and d.provider_destination_ref is not null
  and not exists (
    select 1 from public.bachs_withdrawal_destinations child
    where child.payout_destination_id = d.id and child.status = 'CURRENT'
  );
