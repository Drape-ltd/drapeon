export type StripeReviewPresentation = 'FIRST_RELEASE' | 'REPLACEMENT' | 'NONE'

export function resolveStripeReviewPresentation(input: {
  firstReleaseReviewPending?: boolean
  pendingReview?: boolean
}): StripeReviewPresentation {
  if (input.firstReleaseReviewPending === true) return 'FIRST_RELEASE'
  if (input.pendingReview === true) return 'REPLACEMENT'
  return 'NONE'
}

export function isFirstReleaseReady(
  status: 'PENDING' | 'CLEARED' | 'BLOCKED' | null | undefined
): boolean {
  return status == null || status === 'CLEARED'
}
