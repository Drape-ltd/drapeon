export type UnstartedTrancheFailureCode =
  | 'PRE_PROVIDER_ABORT'
  | 'STRIPE_SOURCE_CHARGE_MISSING'
  | 'PAYOUT_RELEASE_PINNED_DESTINATION_MISSING'
  | 'PAYOUT_RELEASE_PINNED_DESTINATION_MISMATCH'
  | 'PAYOUT_RELEASE_STRIPE_REFRESH_NETWORK_ERROR'
  | 'PAYOUT_RELEASE_STRIPE_REFRESH_FAILED'
  | 'PAYOUT_RELEASE_DESTINATION_READ_FAILED'
  | 'PAYOUT_RELEASE_STRIPE_REFRESH_STALE'
  | 'PAYOUT_RELEASE_STRIPE_CAPABILITY_DISABLED'
  | 'PAYOUT_RELEASE_REFRESH_EVIDENCE_NOT_RECORDED'
  | 'PAYOUT_RELEASE_ORDER_READ_FAILED'
  | 'PAYOUT_RELEASE_STRIPE_SNAPSHOT_MISSING'

const FAILURE_CODES = new Set<UnstartedTrancheFailureCode>([
  'STRIPE_SOURCE_CHARGE_MISSING',
  'PAYOUT_RELEASE_PINNED_DESTINATION_MISSING',
  'PAYOUT_RELEASE_PINNED_DESTINATION_MISMATCH',
  'PAYOUT_RELEASE_STRIPE_REFRESH_NETWORK_ERROR',
  'PAYOUT_RELEASE_STRIPE_REFRESH_FAILED',
  'PAYOUT_RELEASE_DESTINATION_READ_FAILED',
  'PAYOUT_RELEASE_STRIPE_REFRESH_STALE',
  'PAYOUT_RELEASE_STRIPE_CAPABILITY_DISABLED',
  'PAYOUT_RELEASE_REFRESH_EVIDENCE_NOT_RECORDED',
  'PAYOUT_RELEASE_ORDER_READ_FAILED',
  'PAYOUT_RELEASE_STRIPE_SNAPSHOT_MISSING',
])

export function preProviderFailureCode(
  error: unknown,
): UnstartedTrancheFailureCode {
  if (!(error instanceof Error)) return 'PRE_PROVIDER_ABORT'
  const code = error.message.split(':', 1)[0]
  return FAILURE_CODES.has(code as UnstartedTrancheFailureCode)
    ? code as UnstartedTrancheFailureCode
    : 'PRE_PROVIDER_ABORT'
}

export type UnstartedTrancheAbortOutcome =
  | {
    outcome: 'ABORTED' | 'ALREADY_CLOSED'
    claim_id: string
    payout_id?: string
    tranche_id?: string
  }
  | { outcome: 'NOT_SAFE'; claim_id?: string }

export async function closeUnstartedSettlementTranchePayout(
  client: {
    rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
      data: unknown
      error: { message: string } | null
    }>
  },
  input: { claimId: string; failureCode: UnstartedTrancheFailureCode },
): Promise<UnstartedTrancheAbortOutcome> {
  const { data, error } = await client.rpc(
    'close_unstarted_settlement_tranche_payout',
    {
      p_claim_id: input.claimId,
      p_failure_code: input.failureCode,
    },
  )
  if (error) throw new Error(error.message)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Pre-provider payout close returned an invalid result')
  }
  const result = data as Record<string, unknown>
  if (result.outcome === 'NOT_SAFE') return { outcome: 'NOT_SAFE' }
  if (
    (result.outcome === 'ABORTED' || result.outcome === 'ALREADY_CLOSED') &&
    result.claim_id === input.claimId &&
    (result.outcome === 'ALREADY_CLOSED' ||
      (typeof result.payout_id === 'string' &&
        typeof result.tranche_id === 'string'))
  ) {
    return {
      outcome: result.outcome,
      claim_id: input.claimId,
      ...(typeof result.payout_id === 'string'
        ? { payout_id: result.payout_id }
        : {}),
      ...(typeof result.tranche_id === 'string'
        ? { tranche_id: result.tranche_id }
        : {}),
    }
  }
  throw new Error('Pre-provider payout close returned an invalid result')
}

export function preProviderAbortResult(outcome: UnstartedTrancheAbortOutcome) {
  return outcome.outcome === 'ABORTED' || outcome.outcome === 'ALREADY_CLOSED'
    ? {
      status: 409 as const,
      body: {
        ok: false,
        code: 'PAYOUT_PRE_PROVIDER_ABORT',
        error:
          'Payout stopped before a provider transfer started. Ops review is required.',
      },
    }
    : null
}
