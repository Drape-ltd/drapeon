export type CancellationRefundSource =
  | { kind: 'DISPUTE'; disputeId: string }
  | { kind: 'REVIEW'; reviewRequestedAt: string; reviewIssueId: string }

export function resolveCancellationRefundSource(input: {
  disputeId?: string | null
  review?: { status?: string | null; requestedAt?: string | null } | null
  issue?: {
    id?: string | null
    issue_type?: string | null
    status?: string | null
    metadata?: Record<string, unknown> | null
  } | null
}): CancellationRefundSource {
  if (input.disputeId) return { kind: 'DISPUTE', disputeId: input.disputeId }
  if (input.review?.status !== 'OPEN' || !input.review.requestedAt?.trim()) {
    throw new Error('No active dispute or cancellation review was found for this order.')
  }
  const issue = input.issue
  if (
    !issue?.id || issue.issue_type !== 'ORDER_REVIEW' ||
    !['OPEN', 'IN_REVIEW', 'ESCALATED'].includes(issue.status ?? '') ||
    issue.metadata?.review_type !== 'CANCELLATION'
  ) {
    throw new Error('The active cancellation review has no matching Ops case.')
  }
  return { kind: 'REVIEW', reviewRequestedAt: input.review.requestedAt, reviewIssueId: issue.id }
}
