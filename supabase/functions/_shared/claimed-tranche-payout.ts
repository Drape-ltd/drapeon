import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { PayoutClaimReservation } from './payout-claims.ts'

export type SettlementTrancheReservationInput = {
  trancheId: string
  tailorProfileId: string
  moneyDeskRequestId: string
  provider: 'STRIPE' | 'BACHS'
  providerDestinationId: string
  routeVersion: string
  tailorTermsVersion: string
}

export type TrancheFinalization = {
  outcome: 'COMPLETED' | 'EXISTING'
  tranche_id: string
  payout_id: string
  ledger_id: string
  provider_transfer_id: string
  review_needed?: boolean
}

const claimStatuses = new Set([
  'RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'TRANSFERRED',
  'WITHDRAWN', 'FAILED_RECONCILED', 'BLOCKED',
])

export type TranchePayoutClaimReservation = Omit<PayoutClaimReservation, 'payout_id'> & {
  payout_id: string
  source_payment_changed: boolean
}

export async function reserveSettlementTranchePayout(
  supabase: Pick<SupabaseClient, 'rpc'>,
  input: SettlementTrancheReservationInput,
): Promise<TranchePayoutClaimReservation> {
  const { data, error } = await supabase.rpc('reserve_settlement_tranche_payout_row', {
    p_tranche_id: input.trancheId,
    p_tailor_profile_id: input.tailorProfileId,
    p_money_desk_request_id: input.moneyDeskRequestId,
    p_provider: input.provider,
    p_destination_id: input.providerDestinationId,
    p_route_version: input.routeVersion,
    p_tailor_terms_version: input.tailorTermsVersion,
  })
  if (error) throw new Error(error.message)
  if (!data || !['RESERVED', 'EXISTING'].includes(data.outcome)
    || typeof data.claim_id !== 'string'
    || typeof data.payout_id !== 'string'
    || !claimStatuses.has(data.status)
    || data.provider_idempotency_key !== `tranche:${input.trancheId}:op:1`
    || (data.provider_transfer_id != null && typeof data.provider_transfer_id !== 'string')) {
    throw new Error('Settlement tranche reservation returned an invalid claim identity')
  }
  return {
    outcome: data.outcome,
    claim_id: data.claim_id,
    payout_id: data.payout_id,
    status: data.status,
    provider_idempotency_key: data.provider_idempotency_key,
    provider_transfer_id: data.provider_transfer_id ?? null,
    source_payment_changed: data.source_payment_changed === true,
  } as TranchePayoutClaimReservation
}

export async function finalizeClaimedRouteTranche(
  supabase: Pick<SupabaseClient, 'rpc'>,
  input: { claimId: string; payoutId: string; transferId: string },
): Promise<TrancheFinalization> {
  const { data, error } = await supabase.rpc('finalize_claimed_route_tranche_release', {
    p_claim_id: input.claimId,
    p_payout_id: input.payoutId,
    p_provider_transfer_id: input.transferId,
  })
  if (error) throw new Error(error.message)
  if (!data || !['COMPLETED', 'EXISTING'].includes(data.outcome)
    || typeof data.tranche_id !== 'string'
    || typeof data.payout_id !== 'string'
    || typeof data.ledger_id !== 'string'
    || data.provider_transfer_id !== input.transferId
    || data.payout_id !== input.payoutId) {
    throw new Error('Route tranche finalization did not return a matching durable receipt')
  }
  return data as TrancheFinalization
}
