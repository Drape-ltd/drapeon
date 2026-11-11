import type { StripeRefund } from './stripe.ts'

export type FailedRefundTarget = {
  refundId: string
  paymentIntentId: string
  amount: number
}

/** Returns a bounded, journal-safe provider proof or a coded refusal. */
export function failedStripeRefundEvidence(
  target: FailedRefundTarget,
  refunds: StripeRefund[],
  observedAt: string,
): { ok: true; evidence: Record<string, unknown> } | { ok: false; code: string } {
  const matches = refunds.filter((refund) => refund.id === target.refundId)
  if (matches.length !== 1) return { ok: false, code: 'PROVIDER_REFUND_NOT_UNIQUE' }
  const refund = matches[0]
  if (refund.status !== 'failed') return { ok: false, code: 'PROVIDER_REFUND_NOT_FAILED' }
  if (refund.payment_intent !== target.paymentIntentId || refund.amount !== target.amount) {
    return { ok: false, code: 'PROVIDER_REFUND_MISMATCH' }
  }
  if (!refund.failure_reason) return { ok: false, code: 'PROVIDER_FAILURE_REASON_MISSING' }
  return {
    ok: true,
    evidence: {
      status: 'failed',
      refund_id: refund.id,
      payment_intent: refund.payment_intent,
      amount: refund.amount,
      failure_reason: refund.failure_reason,
      observed_at: observedAt,
    },
  }
}
