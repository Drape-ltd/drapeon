import type { PayoutClaimIdentity } from './payout-claims.ts'

export type ReviewedAdjustmentClaimRow = {
  id: string
  business_key: string
  source_kind: string
  source_id: string
  order_id: string
  tailor_profile_id: string
  provider: string
  provider_destination_id: string
  currency: string
  amount: number
  route_version: string
  earning_policy_version: string
  tailor_terms_version: string | null
  provider_idempotency_key: string
}

/** Build a payout identity only from the immutable adjustment claim created
 * from the order's accepted route snapshot. Legacy Paystack and missing
 * snapshots fail closed instead of being inferred from currency or profile. */
export function reviewedAdjustmentPayoutIdentity(
  claim: ReviewedAdjustmentClaimRow
): PayoutClaimIdentity {
  const expectedBusinessKey = `adjustment:${claim.source_id}`
  const expectedProviderKey = `${expectedBusinessKey}:op:1`
  if (
    claim.source_kind !== 'TAILOR_ADJUSTMENT' ||
    claim.business_key !== expectedBusinessKey ||
    !['STRIPE', 'BACHS'].includes(claim.provider) ||
    !claim.source_id.trim() ||
    !claim.order_id.trim() ||
    !claim.tailor_profile_id.trim() ||
    !claim.provider_destination_id.trim() ||
    !claim.currency.trim() ||
    !claim.route_version.trim() ||
    claim.earning_policy_version !== 'tailor-adjustment-delivery-72h-reviewed-v1' ||
    !Number.isSafeInteger(claim.amount) ||
    claim.amount <= 0 ||
    claim.provider_idempotency_key !== expectedProviderKey
  ) {
    throw new Error('Reviewed adjustment claim is missing its accepted payout identity')
  }
  return {
    businessKey: claim.business_key,
    sourceKind: 'TAILOR_ADJUSTMENT',
    sourceId: claim.source_id,
    orderId: claim.order_id,
    tailorProfileId: claim.tailor_profile_id,
    provider: claim.provider,
    destinationId: claim.provider_destination_id,
    currency: claim.currency,
    amount: claim.amount,
    routeVersion: claim.route_version,
    earningPolicyVersion: claim.earning_policy_version,
    tailorTermsVersion: claim.tailor_terms_version,
    providerIdempotencyKey: claim.provider_idempotency_key,
  }
}
