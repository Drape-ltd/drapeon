import type { StripeRefund } from './stripe.ts'

export function confirmedTipRefundEvidence(
  target: { refundId: string; paymentIntentId: string; amount: number },
  refunds: StripeRefund[],
  observedAt: string,
): { ok: true; evidence: Record<string, unknown> } | { ok: false; code: string } {
  const matching = refunds.filter((refund) => refund.id === target.refundId)
  if (matching.length !== 1) return { ok: false, code: 'TIP_REFUND_NOT_UNIQUE' }
  const refund = matching[0]
  if (refund.status !== 'succeeded') return { ok: false, code: 'TIP_REFUND_NOT_SUCCEEDED' }
  if (refund.payment_intent !== target.paymentIntentId || refund.amount !== target.amount) {
    return { ok: false, code: 'TIP_REFUND_PROVIDER_IDENTITY_MISMATCH' }
  }
  // This is retrieval evidence for an already completed provider refund.
  // Callers must not create or retry a refund from this path.
  return { ok: true, evidence: {
    status: 'succeeded', refund_id: refund.id,
    payment_intent: refund.payment_intent, amount: refund.amount,
    observed_at: observedAt,
  } }
}
