-- Reconcile only provider outcomes with a single, exact claim-operation match.
-- Ambiguous historical attempts stay unlinked for Ops review; nothing here
-- creates a provider operation or replays a transfer.

update public.payout_attempts
set observed_provider_transfer_ids = array[provider_operation_id]
where provider_operation_id is not null
  and nullif(btrim(provider_operation_id), '') is not null
  and cardinality(observed_provider_transfer_ids) = 0;

update public.payout_provider_operations o
set status = 'TRANSFERRED',
    provider_transfer_id = a.provider_operation_id
from public.payout_claims c
join public.payout_attempts a
  on a.claim_id = c.id and a.status = 'SUCCEEDED'
where o.claim_id = c.id
  and c.status in ('TRANSFERRED', 'WITHDRAWN')
  and c.transfer_status = 'CONFIRMED'
  and nullif(btrim(c.provider_transfer_id), '') = a.provider_operation_id
  and nullif(btrim(a.provider_operation_id), '') is not null
  and o.provider = c.provider
  and o.provider_destination_id = c.provider_destination_id
  and o.currency = c.currency
  and o.amount = c.amount
  and o.provider_idempotency_key = c.provider_idempotency_key
  and o.status in ('RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'TRANSFERRED')
  and o.provider_transfer_id is null
  and (select count(*) from public.payout_provider_operations ox where ox.claim_id = c.id) = 1
  and (select count(*) from public.payout_attempts ax
    where ax.claim_id = c.id and ax.status = 'SUCCEEDED') = 1;

update public.payout_attempts a
set claim_operation_id = o.id
from public.payout_provider_operations o
where a.claim_id = o.claim_id
  and a.claim_operation_id is null
  and a.status = 'SUCCEEDED'
  and nullif(btrim(a.provider_operation_id), '') = o.provider_transfer_id
  and o.status in ('TRANSFERRED','WITHDRAWN','LATE_SUCCEEDED')
  and o.provider = (select c.provider from public.payout_claims c where c.id = a.claim_id)
  and o.provider_destination_id = (select c.provider_destination_id from public.payout_claims c where c.id = a.claim_id)
  and o.currency = (select c.currency from public.payout_claims c where c.id = a.claim_id)
  and o.amount = (select c.amount from public.payout_claims c where c.id = a.claim_id)
  and o.provider_idempotency_key = (select c.provider_idempotency_key from public.payout_claims c where c.id = a.claim_id)
  and (select count(*) from public.payout_provider_operations one_op
    where one_op.claim_id = a.claim_id) = 1
  and (select count(*) from public.payout_attempts successful_attempt
    where successful_attempt.claim_id = a.claim_id
      and successful_attempt.status = 'SUCCEEDED') = 1;
