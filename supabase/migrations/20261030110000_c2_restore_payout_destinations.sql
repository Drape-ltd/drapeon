-- C2 data repair: restore only destinations supported by immutable claim or
-- provider-operation evidence. Never infer a destination from a current profile.
with candidates as (
  select claim.payout_id, claim.provider_destination_id
  from public.payout_claims claim
  where nullif(btrim(claim.provider_destination_id), '') is not null
  union all
  select tip_claim.payout_id,
    nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'), '')
  from public.tip_money_operation_claims tip_claim
  where nullif(btrim(tip_claim.provider_response #>> '{transfer,destination}'), '') is not null
), unambiguous as (
  select payout_id, min(provider_destination_id) as provider_destination_id
  from candidates
  group by payout_id
  having count(distinct provider_destination_id) = 1
)
update public.payouts payout
set provider_destination_id = unambiguous.provider_destination_id,
    provider_response = coalesce(payout.provider_response, '{}'::jsonb)
      || jsonb_build_object('c2_destination_repaired_at', now())
from unambiguous
where payout.id::text = unambiguous.payout_id
  and payout.provider_destination_id is null;

