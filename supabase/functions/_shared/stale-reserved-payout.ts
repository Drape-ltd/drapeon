const STALE_AFTER_MS = 30 * 60 * 1000
const STALE_SCAN_PAGE_SIZE = 100

export function stalePayoutScanWindow(total: number, nowMs = Date.now()) {
  const pages = Math.max(1, Math.ceil(total / STALE_SCAN_PAGE_SIZE))
  const page = Math.floor(nowMs / STALE_AFTER_MS) % pages
  return { from: page * STALE_SCAN_PAGE_SIZE, to: (page + 1) * STALE_SCAN_PAGE_SIZE - 1, pages }
}

export type StaleReservedPayoutCandidate = {
  claimId: string
  sourceKind: string
  sourceId: string
  claimStatus: string
  claimUpdatedAt: string
  attemptCount: number
  orderId: string
  payoutId: string
  payoutStatus: string
  provider: string
  providerPayoutId: string | null
  providerTransferStatus: string | null
  providerTransferId: string | null
  tailorProfileId: string
}

export function isStaleUnstartedPayout(
  candidate: StaleReservedPayoutCandidate,
  nowMs = Date.now(),
) {
  const updatedAt = Date.parse(candidate.claimUpdatedAt)
  return Number.isFinite(updatedAt) &&
    nowMs - updatedAt >= STALE_AFTER_MS &&
    candidate.claimStatus === 'RESERVED' &&
    candidate.attemptCount === 0 &&
    candidate.payoutStatus === 'PROCESSING' &&
    candidate.providerTransferStatus === 'PROCESSING' &&
    candidate.providerTransferId === null &&
    candidate.providerPayoutId === null
}

export function staleUnstartedPayoutIssue(
  candidate: StaleReservedPayoutCandidate,
) {
  return {
    issueType: 'PAYOUT_FAILED' as const,
    severity: 'HIGH' as const,
    source: 'monitor-settlements',
    actorRole: 'SYSTEM',
    orderId: candidate.orderId,
    tailorProfileId: candidate.tailorProfileId,
    provider: candidate.provider,
    sourceKind: candidate.sourceKind,
    relatedEntityType: 'PAYOUT_CLAIM',
    relatedEntityId: candidate.claimId,
    title: 'Payout reservation has not started a provider transfer',
    description:
      'A payout remains processing with no provider attempt or transfer reference after 30 minutes.',
    recommendedAction:
      'Review the payout claim and approved request. Do not retry or send a transfer until the reservation is reconciled.',
    dedupeKey: `unstarted-payout-reservation:${candidate.claimId}`,
    queueKey: 'money-desk' as const,
    notifyOps: true,
    notifyOpsPush: true,
    persistWhenRoutineDisabled: true,
    skipIfUnchanged: true,
    preserveWorkflowState: true,
    metadata: {
      claim_id: candidate.claimId,
      payout_id: candidate.payoutId,
      source_kind: candidate.sourceKind,
      source_id: candidate.sourceId,
      provider: candidate.provider,
      failure_class: 'stale_unstarted_provider_reservation',
    },
  }
}
