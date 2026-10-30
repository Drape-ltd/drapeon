type PaymentProvider = 'STRIPE' | 'PAYSTACK' | 'BACHS' | 'COVERAGE'
type ExternalPaymentProvider = Exclude<PaymentProvider, 'COVERAGE'>

type PaymentAttemptLike = {
  provider: PaymentProvider
  provider_payment_id: string | null
  provider_checkout_url?: string | null
}

type PaymentAttemptStatus = 'INITIATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'PARTIAL_REFUND' | 'REFUNDED'

export function canReplacePreparedPaymentAfterAmountChange(input: {
  action: 'prepare-payment' | 'confirm-payment'
  attemptStatus?: PaymentAttemptStatus | null
}) {
  return input.action === 'prepare-payment'
    && (input.attemptStatus === 'FAILED' || input.attemptStatus === 'CANCELED')
}

export function stripePrepareIdempotencyKey(input: {
  baseKey: string
  action: 'prepare-payment' | 'confirm-payment'
  orderStage: string
  attemptId?: string | null
  attemptStatus?: PaymentAttemptStatus | null
  attemptIdempotencyKey?: string | null
}) {
  if (input.action !== 'prepare-payment') return input.baseKey
  if (
    (input.attemptStatus === 'INITIATED' || input.attemptStatus === 'PENDING')
    && input.attemptIdempotencyKey?.trim()
  ) {
    return input.attemptIdempotencyKey.trim()
  }
  if (
    input.orderStage === 'PAYMENT_FAILED'
    && (input.attemptStatus === 'FAILED' || input.attemptStatus === 'CANCELED')
    && input.attemptId?.trim()
  ) {
    return `${input.baseKey}-R-${input.attemptId.trim()}`
  }
  return input.baseKey
}

export function resolvePreparedPaymentReference(input: {
  expectedProvider: ExternalPaymentProvider
  storedPaymentIntentId?: string | null
  storedCheckoutUrl?: string | null
  latestAttempt?: PaymentAttemptLike | null
}) {
  const storedPaymentIntentId = input.storedPaymentIntentId?.trim() || null
  const storedCheckoutUrl = input.storedCheckoutUrl?.trim() || null

  if (!input.latestAttempt) {
    return {
      providerPaymentId: storedPaymentIntentId,
      providerCheckoutUrl: storedCheckoutUrl,
      recoveredFromLedger: false,
      providerMismatch: false,
    }
  }

  if (input.latestAttempt.provider !== input.expectedProvider) {
    return {
      providerPaymentId: storedPaymentIntentId,
      providerCheckoutUrl: storedCheckoutUrl,
      recoveredFromLedger: false,
      providerMismatch: true,
    }
  }

  const recoveredPaymentId = input.latestAttempt.provider_payment_id?.trim() || null
  const recoveredCheckoutUrl = input.latestAttempt.provider_checkout_url?.trim() || null

  return {
    providerPaymentId: storedPaymentIntentId ?? recoveredPaymentId,
    providerCheckoutUrl: storedCheckoutUrl ?? recoveredCheckoutUrl,
    recoveredFromLedger: !storedPaymentIntentId && !!recoveredPaymentId,
    providerMismatch: false,
  }
}
