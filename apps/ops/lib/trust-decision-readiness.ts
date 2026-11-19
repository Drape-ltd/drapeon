export type TrustDecision = 'APPROVE' | 'REJECT'

export function trustDecisionDisabledReason(input: {
  decision: TrustDecision
  evidenceReady: boolean
  evidenceReviewed: boolean
  protectedAccess: boolean
  recordVersion: number | null
  pending: TrustDecision | null
  placementReady: boolean
  rejectionReasonValid: boolean
}): string | null {
  if (!input.evidenceReady) return 'Private challenge evidence missing'
  if (!input.protectedAccess) return 'Protected access expired: verify again'
  if (input.recordVersion === null) return 'Record version missing'
  if (!input.evidenceReviewed) return 'Tick the evidence review box'
  if (input.pending !== null) return 'Decision in progress'
  if (input.decision === 'APPROVE' && !input.placementReady) return 'Choose an Explore placement'
  if (input.decision === 'REJECT' && !input.rejectionReasonValid) return 'Enter at least 8 characters for rejection'
  return null
}
