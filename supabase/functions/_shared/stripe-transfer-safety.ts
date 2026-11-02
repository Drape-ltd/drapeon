import { StripeApiError } from './stripe.ts'

type PaymentWithProviderResponse = {
  provider_response?: Record<string, unknown> | null
}

function chargeId(value: unknown): string | null {
  if (typeof value === 'string' && value.startsWith('ch_')) return value
  if (value && typeof value === 'object') {
    const id = (value as Record<string, unknown>).id
    if (typeof id === 'string' && id.startsWith('ch_')) return id
  }
  return null
}

export function stripeSourceCharge(payment: PaymentWithProviderResponse | null | undefined) {
  const response = payment?.provider_response
  if (!response || typeof response !== 'object') return null
  const data = response.data && typeof response.data === 'object'
    ? response.data as Record<string, unknown>
    : null
  const object = data?.object && typeof data.object === 'object'
    ? data.object as Record<string, unknown>
    : null
  const paymentIntent = response.payment_intent && typeof response.payment_intent === 'object'
    ? response.payment_intent as Record<string, unknown>
    : null

  for (const candidate of [
    response.latest_charge,
    response.charge,
    paymentIntent?.latest_charge,
    object?.latest_charge,
    object?.charge,
  ]) {
    const id = chargeId(candidate)
    if (id) return id
  }
  return null
}

export function requireStripeSourceCharge(
  payment: PaymentWithProviderResponse | null | undefined,
  code = 'STRIPE_SOURCE_CHARGE_MISSING',
) {
  const source = stripeSourceCharge(payment)
  if (!source) throw new Error(code)
  return source
}

export type StripeTransferFailure = {
  outcome: 'DEFINITE' | 'AMBIGUOUS'
  code: string
  status: number | null
  requestId: string | null
}

export function classifyStripeTransferFailure(error: unknown): StripeTransferFailure {
  if (error instanceof StripeApiError) {
    const code = error.stripeCode ?? error.stripeType ?? 'STRIPE_REQUEST_FAILED'
    if ([400, 402, 403].includes(error.status) && Boolean(error.stripeCode)) {
      return { outcome: 'DEFINITE', code, status: error.status, requestId: error.requestId }
    }
    return { outcome: 'AMBIGUOUS', code, status: error.status, requestId: error.requestId }
  }
  return { outcome: 'AMBIGUOUS', code: 'STRIPE_OUTCOME_UNCLEAR', status: null, requestId: null }
}

export function fabricTransferIdempotencyKey(candidateId: string, attemptNumber: number) {
  return attemptNumber <= 1
    ? `DRAPE-FABRIC-V2-${candidateId}`
    : `DRAPE-FABRIC-V2-${candidateId}-a${attemptNumber}`
}

/**
 * Legacy payout flows create a new immutable payout row for each reviewed
 * attempt. Binding the Stripe key to that row preserves retry idempotency for
 * the same attempt while ensuring a later reviewed attempt cannot replay a
 * prior definite rejection cached under Stripe's 24-hour key window.
 */
export function legacyStripePayoutAttemptKey(
  purpose: 'TRANCHE' | 'TIP' | 'CONSULTATION',
  businessId: string,
  payoutId: string,
) {
  return `DRAPE-${purpose}-${businessId}-PAYOUT-${payoutId}`
}
