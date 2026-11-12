import type { StripePaymentIntent } from './stripe.ts'

export type StripeReplacementResult =
  | { kind: 'replace'; paymentIntent: StripePaymentIntent }
  | { kind: 'succeeded'; paymentIntent: StripePaymentIntent }
  | { kind: 'pending'; paymentIntent: StripePaymentIntent }

export function stripeReplacementCancelKey(attemptId: string) {
  return `DRAPE-CANCEL-REPLACE-${attemptId}`
}

export function stripeReplacementPrepareKey(baseKey: string, attemptId: string) {
  return `${baseKey}-R-${attemptId}`
}

function classify(paymentIntent: StripePaymentIntent): 'replace' | 'succeeded' | 'pending' | 'cancel' {
  if (paymentIntent.status === 'canceled') return 'replace'
  if (paymentIntent.status === 'succeeded') return 'succeeded'
  if (paymentIntent.status === 'processing') return 'pending'
  return 'cancel'
}

export async function cancelStripeAttemptBeforeReplacement(input: {
  attemptId: string
  paymentIntentId: string
  retrieve: (paymentIntentId: string) => Promise<StripePaymentIntent>
  cancel: (paymentIntentId: string, idempotencyKey: string) => Promise<StripePaymentIntent>
  markSuperseded: (paymentIntent: StripePaymentIntent) => Promise<void>
}): Promise<StripeReplacementResult> {
  let paymentIntent = await input.retrieve(input.paymentIntentId)
  let disposition = classify(paymentIntent)

  if (disposition === 'succeeded') return { kind: 'succeeded', paymentIntent }
  if (disposition === 'pending') return { kind: 'pending', paymentIntent }

  if (disposition === 'cancel') {
    try {
      paymentIntent = await input.cancel(
        input.paymentIntentId,
        stripeReplacementCancelKey(input.attemptId),
      )
    } catch {
      // A concurrent retry or customer action can win the cancel race. Always
      // reread Stripe before deciding whether a replacement is safe.
      paymentIntent = await input.retrieve(input.paymentIntentId)
    }
    disposition = classify(paymentIntent)
  }

  if (disposition === 'succeeded') return { kind: 'succeeded', paymentIntent }
  if (disposition === 'pending') return { kind: 'pending', paymentIntent }
  if (disposition !== 'replace') {
    throw new Error(`Stripe replacement cancellation remained ${paymentIntent.status}.`)
  }

  await input.markSuperseded(paymentIntent)
  return { kind: 'replace', paymentIntent }
}
