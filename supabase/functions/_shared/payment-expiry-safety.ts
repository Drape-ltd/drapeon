export type StripePaymentIntentSnapshot = {
  id: string
  status: string
}

/** Checkout providers that support minute-based expiry use this shared window. */
export const PAYMENT_PENDING_TIMEOUT_MINUTES = 30

export type StripeExpiryResolution =
  | { kind: 'canceled'; paymentIntent: StripePaymentIntentSnapshot }
  | { kind: 'succeeded'; paymentIntent: StripePaymentIntentSnapshot }
  | {
      kind: 'nonterminal'
      paymentIntent: StripePaymentIntentSnapshot
      cancelFailed: boolean
    }
  | { kind: 'unknown'; cancelFailed: boolean }

/**
 * A successful cancel response is not enough to expire an order: retrieve the
 * provider object afterwards and make the local decision from that final state.
 */
export async function cancelThenRetrieveStripePaymentIntent(
  paymentIntentId: string,
  cancel: (id: string) => Promise<unknown>,
  retrieve: (id: string) => Promise<StripePaymentIntentSnapshot>
): Promise<StripeExpiryResolution> {
  let cancelFailed = false
  try {
    await cancel(paymentIntentId)
  } catch {
    // Cancellation can lose a race with a successful payment. Retrieval below
    // determines the outcome; the cancellation error alone is not authoritative.
    cancelFailed = true
  }

  let paymentIntent: StripePaymentIntentSnapshot
  try {
    paymentIntent = await retrieve(paymentIntentId)
  } catch {
    return { kind: 'unknown', cancelFailed }
  }

  if (paymentIntent.id !== paymentIntentId) {
    return { kind: 'unknown', cancelFailed }
  }
  if (paymentIntent.status === 'canceled') {
    return { kind: 'canceled', paymentIntent }
  }
  if (paymentIntent.status === 'succeeded') {
    return { kind: 'succeeded', paymentIntent }
  }
  return { kind: 'nonterminal', paymentIntent, cancelFailed }
}

export function initialStripePaymentSuccessReviewReason(input: {
  orderId: string
  attemptOrderId: string | null | undefined
  attemptPhase: string | null | undefined
  attemptStatus: string | null | undefined
  orderStage: string
  currentPaymentIntentId: string | null | undefined
  succeededPaymentIntentId: string
}): string | null {
  if (!input.attemptOrderId) return 'payment_attempt_missing'
  if (input.attemptOrderId !== input.orderId) {
    return 'payment_attempt_order_mismatch'
  }
  if (input.attemptPhase !== 'INITIAL_ORDER') {
    return 'payment_attempt_phase_mismatch'
  }
  if (input.currentPaymentIntentId !== input.succeededPaymentIntentId) {
    return 'payment_reference_not_current'
  }
  if (input.attemptStatus === 'FAILED' || input.attemptStatus === 'CANCELED') {
    return 'payment_attempt_was_terminal'
  }
  if (input.orderStage === 'PAYMENT_FAILED') return 'order_payment_failed'
  if (!['PAYMENT_PENDING', 'CONFIRMED'].includes(input.orderStage)) {
    return 'order_not_payable'
  }
  return null
}
