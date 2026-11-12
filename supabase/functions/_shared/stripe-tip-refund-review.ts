export type TipRefundReviewInput = {
  paymentId: string
  paymentStatus: string
  refundId: string
  refundStatus: string
}

export type TipRefundReviewDependencies = {
  loadTip: (paymentId: string) => Promise<{ id: string; status: string } | null>
  loadClaim: (tipId: string) => Promise<{ status: string; providerOperationId: string | null } | null>
  hasExactJournal: (paymentId: string, refundId: string) => Promise<boolean>
  openReviewIssue: () => Promise<boolean>
  markProcessed: (result: string, reconciliationRequired: boolean) => Promise<void>
}

export function tipRefundNeedsBusinessReconciliation(
  processingResult: string | null | undefined,
  providerEventMatched: boolean,
) {
  return providerEventMatched && processingResult === 'stripe_tip_refund_requires_review'
}

// A signed Stripe event proves the provider outcome, not the independent TIP
// approval, claim, and ledger contract. Never send it through the general
// order-refund finalizer or its order-level customer notifications.
export async function reviewStripeTipRefund(
  input: TipRefundReviewInput,
  deps: TipRefundReviewDependencies,
) {
  const tip = await deps.loadTip(input.paymentId)
  const claim = tip ? await deps.loadClaim(tip.id) : null
  const alreadyFinalized = input.refundStatus === 'succeeded' &&
    input.paymentStatus === 'REFUNDED' && tip?.status === 'REFUNDED' &&
    claim?.status === 'SUCCEEDED' && claim.providerOperationId === input.refundId &&
    await deps.hasExactJournal(input.paymentId, input.refundId)
  if (alreadyFinalized) {
    await deps.markProcessed('stripe_tip_refund_already_finalized', false)
    return { matched: true, duplicate: true, status: input.refundStatus }
  }
  if (!await deps.openReviewIssue()) {
    throw new Error('The Stripe TIP refund reconciliation case could not be recorded.')
  }
  await deps.markProcessed('stripe_tip_refund_requires_review', true)
  return { matched: true, reconciliationRequired: true, status: input.refundStatus }
}
