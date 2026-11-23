import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type TipClaimStatus = 'RESERVED' | 'PROVIDER_UNKNOWN' | 'PROVIDER_PENDING' | 'SUCCEEDED' | 'FAILED_RECONCILED' | 'BLOCKED_IDENTITY'
export type TipClaimOutcome = 'RESERVED' | 'EXISTING' | 'BLOCKED_BY_REFUND' | 'WAIT_PAYOUT' | 'WAIT_LEGACY_PAYOUT' | 'NOT_RELEASABLE' | 'NOT_REFUNDABLE'

export type TipClaimReservation = {
  outcome: TipClaimOutcome
  claim_id?: string
  status?: TipClaimStatus
  refund_funding_mode?: 'UNPAID_TIP' | 'POST_PAYOUT' | null
  provider_operation_id?: string | null
}

const CLAIM_OUTCOMES = new Set<TipClaimOutcome>([
  'RESERVED', 'EXISTING', 'BLOCKED_BY_REFUND', 'WAIT_PAYOUT',
  'WAIT_LEGACY_PAYOUT', 'NOT_RELEASABLE', 'NOT_REFUNDABLE',
])

export async function reserveTipMoneyOperation(
  supabase: SupabaseClient,
  input: { tipId: string; kind: 'PAYOUT' | 'REFUND'; key: string; moneyDeskRequestId?: string | null },
): Promise<TipClaimReservation> {
  const { data, error } = await supabase.rpc('reserve_tip_money_operation', {
    p_tip_id: input.tipId,
    p_operation_kind: input.kind,
    p_request_key: input.key,
    p_money_desk_request_id: input.moneyDeskRequestId ?? null,
  })
  if (error) throw new Error(error.message)
  if (!data || typeof data !== 'object' || !CLAIM_OUTCOMES.has(data.outcome as TipClaimOutcome)) {
    throw new Error('Tip claim reservation returned an unknown outcome')
  }
  if ((data.outcome === 'RESERVED' || data.outcome === 'EXISTING') && typeof data.claim_id !== 'string') {
    throw new Error('Tip claim reservation did not return its durable ID')
  }
  return data as TipClaimReservation
}

export async function bindTipPayoutClaim(
  supabase: SupabaseClient,
  input: { claimId: string; payoutId: string; provider: string; destinationId: string },
): Promise<'BOUND' | 'EXISTING'> {
  const { data, error } = await supabase.rpc('bind_tip_payout_claim', {
    p_claim_id: input.claimId,
    p_payout_id: input.payoutId,
    p_provider: input.provider,
    p_provider_destination_id: input.destinationId,
  })
  if (error) throw new Error(error.message)
  if (data?.claim_id !== input.claimId || data?.payout_id !== input.payoutId
    || !['BOUND', 'EXISTING'].includes(data?.outcome)) {
    throw new Error('TIP payout row could not be bound to its immutable claim')
  }
  return data.outcome
}

export type TipPayoutStart = {
  action: 'SEND' | 'RECONCILE'
  claim_id: string
  payout_id: string | null
  provider: string | null
  provider_operation_id: string | null
  status?: TipClaimStatus
}

export async function startTipMoneyOperationProviderCall(
  supabase: SupabaseClient,
  claimId: string,
): Promise<TipPayoutStart> {
  const { data, error } = await supabase.rpc('start_tip_money_operation_provider_call', {
    p_claim_id: claimId,
  })
  if (error) throw new Error(error.message)
  if (!data || data.claim_id !== claimId || !['SEND', 'RECONCILE'].includes(data.outcome)
    || (data.payout_id != null && typeof data.payout_id !== 'string')) {
    throw new Error('TIP payout provider start gate returned an invalid result')
  }
  return {
    action: data.outcome === 'SEND' ? 'SEND' : 'RECONCILE',
    claim_id: claimId,
    payout_id: typeof data.payout_id === 'string' ? data.payout_id : null,
    provider: typeof data.provider === 'string' ? data.provider : null,
    provider_operation_id: typeof data.provider_operation_id === 'string'
      ? data.provider_operation_id
      : null,
    ...(typeof data.status === 'string' ? { status: data.status as TipClaimStatus } : {}),
  }
}

export async function recordTipMoneyOperationOutcome(
  supabase: SupabaseClient,
  input: {
    claimId: string
    status: Exclude<TipClaimStatus, 'RESERVED' | 'BLOCKED_IDENTITY'>
    provider: string
    providerOperationId?: string | null
    evidence: Record<string, unknown>
  },
): Promise<'RECORDED' | 'EXISTING' | 'LATE_SUCCESS'> {
  const { data, error } = await supabase.rpc('record_tip_money_operation_outcome', {
    p_claim_id: input.claimId,
    p_next_status: input.status,
    p_provider: input.provider,
    p_provider_operation_id: input.providerOperationId ?? null,
    p_provider_response: input.evidence,
  })
  if (error) throw new Error(error.message)
  if (!data || !['RECORDED', 'EXISTING', 'LATE_SUCCESS'].includes(data.outcome)
    || data.status !== input.status) {
    throw new Error('Tip claim outcome was not durably recorded')
  }
  return data.outcome as 'RECORDED' | 'EXISTING' | 'LATE_SUCCESS'
}

export async function blockTipPayoutIdentityConflict(
  supabase: SupabaseClient,
  input: { claimId: string; provider: string; evidence: Record<string, unknown> },
): Promise<void> {
  const { data, error } = await supabase.rpc('block_tip_payout_identity_conflict', {
    p_claim_id: input.claimId,
    p_provider: input.provider,
    p_evidence: input.evidence,
  })
  if (error || data?.outcome !== 'BLOCKED_IDENTITY' || data?.claim_id !== input.claimId) {
    throw new Error(error?.message ?? 'Tip payout conflict could not be blocked and queued for Ops')
  }
}
