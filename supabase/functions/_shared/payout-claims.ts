import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type PayoutClaimStatus =
  | 'RESERVED' | 'PROVIDER_UNKNOWN' | 'PROVIDER_PENDING'
  | 'TRANSFERRED' | 'WITHDRAWN' | 'FAILED_RECONCILED' | 'BLOCKED'

export type PayoutClaimReservation = {
  outcome: 'RESERVED' | 'EXISTING'
  claim_id: string
  status: PayoutClaimStatus
  provider_idempotency_key: string
  provider_transfer_id: string | null
  payout_id: string | null
}

export type PayoutAttemptAction = {
  action: 'PROVIDER_CALL' | 'RECONCILE' | 'RECONCILE_FIRST' | 'DONE' | 'BLOCKED'
  claim_id: string
  attempt_id?: string
  provider_idempotency_key?: string
  provider_transfer_id?: string | null
}

export type PayoutClaimIdentity = {
  businessKey: string
  sourceKind: 'ORDER_EARNING' | 'SETTLEMENT_TRANCHE' | 'TIP' | 'MATERIAL_ADVANCE'
    | 'FABRIC_RELEASE' | 'CONSULTATION_EARNING' | 'RESIDUAL_SETTLEMENT'
    | 'TAILOR_ADJUSTMENT'
  sourceId: string
  orderId: string
  tailorProfileId: string
  provider: string
  destinationId: string
  currency: string
  amount: number
  routeVersion: string
  earningPolicyVersion: string
  tailorTermsVersion?: string | null
  providerIdempotencyKey: string
}

const claimStatuses = new Set<PayoutClaimStatus>([
  'RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'TRANSFERRED',
  'WITHDRAWN', 'FAILED_RECONCILED', 'BLOCKED',
])
const attemptActions = new Set<PayoutAttemptAction['action']>([
  'PROVIDER_CALL', 'RECONCILE', 'RECONCILE_FIRST', 'DONE', 'BLOCKED',
])

export async function reservePayoutClaim(
  supabase: SupabaseClient,
  input: PayoutClaimIdentity,
): Promise<PayoutClaimReservation> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error('A payout claim requires a positive integer amount')
  }
  const { data, error } = await supabase.rpc('reserve_payout_claim', {
    p_business_key: input.businessKey,
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId,
    p_order_id: input.orderId,
    p_tailor_profile_id: input.tailorProfileId,
    p_provider: input.provider,
    p_provider_destination_id: input.destinationId,
    p_currency: input.currency,
    p_amount: input.amount,
    p_route_version: input.routeVersion,
    p_earning_policy_version: input.earningPolicyVersion,
    p_tailor_terms_version: input.tailorTermsVersion ?? null,
    p_provider_idempotency_key: input.providerIdempotencyKey,
  })
  if (error) throw new Error(error.message)
  if (!data || (data.outcome !== 'RESERVED' && data.outcome !== 'EXISTING')
    || typeof data.claim_id !== 'string' || !claimStatuses.has(data.status)
    || data.provider_idempotency_key !== input.providerIdempotencyKey) {
    throw new Error('Payout claim reservation returned an invalid identity or outcome')
  }
  return data as PayoutClaimReservation
}

export async function startPayoutAttempt(
  supabase: SupabaseClient,
  claim: PayoutClaimReservation,
): Promise<PayoutAttemptAction> {
  const mode = claim.status === 'PROVIDER_UNKNOWN' || claim.status === 'PROVIDER_PENDING'
    ? 'RECONCILE' : 'PROVIDER_CALL'
  const { data, error } = await supabase.rpc('start_payout_attempt', {
    p_claim_id: claim.claim_id,
    p_mode: mode,
  })
  if (error) throw new Error(error.message)
  if (!data || !attemptActions.has(data.action) || data.claim_id !== claim.claim_id) {
    throw new Error('Payout attempt returned an invalid action')
  }
  if ((data.action === 'PROVIDER_CALL' || data.action === 'RECONCILE')
    && (typeof data.attempt_id !== 'string'
      || data.provider_idempotency_key !== claim.provider_idempotency_key)) {
    throw new Error('Payout attempt did not preserve the claim provider key')
  }
  return data as PayoutAttemptAction
}

export async function recordPayoutAttemptOutcome(
  supabase: SupabaseClient,
  input: {
    attemptId: string
    status: 'PROVIDER_UNKNOWN' | 'PROVIDER_PENDING' | 'SUCCEEDED' | 'FAILED_RECONCILED'
    providerTransferId?: string | null
    evidence: Record<string, unknown>
  },
): Promise<'RECORDED' | 'EXISTING'> {
  if (input.status === 'SUCCEEDED' && !input.providerTransferId) {
    throw new Error('Confirmed payout needs a provider transfer reference')
  }
  const { data, error } = await supabase.rpc('record_payout_attempt_outcome', {
    p_attempt_id: input.attemptId,
    p_status: input.status,
    p_provider_transfer_id: input.providerTransferId ?? null,
    p_evidence: input.evidence,
  })
  if (error) throw new Error(error.message)
  if (!data || (data.outcome !== 'RECORDED' && data.outcome !== 'EXISTING')) {
    throw new Error('Payout attempt outcome was not durably recorded')
  }
  return data.outcome
}
