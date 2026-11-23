import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { audit } from './logger.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'

export async function openStripePaymentReviewIssue(
  supabase: SupabaseClient,
  input: {
    orderId: string
    orderReference?: string | null
    customerId?: string | null
    stage?: string | null
    providerPaymentId: string
    paymentAttemptId?: string | null
    paymentPhase?: string | null
    providerStatus?: string | null
    currency?: string | null
    amountMinor?: number | null
    reason: string
    source: string
  }
) {
  const orderLabel = input.orderReference?.trim() || input.orderId
  const description = `Stripe payment ${input.providerPaymentId} for order ${orderLabel} could not be safely reconciled automatically (${input.reason}).`

  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYMENT_BLOCKED',
    severity: 'HIGH',
    source: input.source,
    actorRole: 'SYSTEM',
    orderId: input.orderId,
    userId: input.customerId ?? null,
    provider: 'STRIPE',
    stage: input.stage ?? null,
    relatedEntityType: input.paymentAttemptId ? 'order_payment' : 'stripe_payment_intent',
    relatedEntityId: input.paymentAttemptId ?? input.providerPaymentId,
    title: 'Stripe payment needs Ops review',
    description,
    recommendedAction:
      'Verify the captured Stripe payment against the accepted order, then use the reviewed reinstate-or-refund flow. Do not create another charge or payout while this case is open.',
    dedupeKey: `stripe-payment-review:${input.providerPaymentId}`,
    queueKey: 'money-desk',
    persistWhenRoutineDisabled: true,
    metadata: {
      provider_payment_id: input.providerPaymentId,
      payment_attempt_id: input.paymentAttemptId ?? null,
      payment_phase: input.paymentPhase ?? null,
      provider_status: input.providerStatus ?? null,
      currency: input.currency?.toUpperCase() ?? null,
      amount_minor: input.amountMinor ?? null,
      review_reason: input.reason,
    },
  })

  await audit(supabase, {
    event: 'payment.provider_state_requires_ops_review',
    actor_role: 'SYSTEM',
    order_id: input.orderId,
    severity: 'error',
    payload: {
      source: input.source,
      provider: 'STRIPE',
      provider_payment_id: input.providerPaymentId,
      payment_attempt_id: input.paymentAttemptId ?? null,
      payment_phase: input.paymentPhase ?? null,
      provider_status: input.providerStatus ?? null,
      currency: input.currency?.toUpperCase() ?? null,
      amount_minor: input.amountMinor ?? null,
      review_reason: input.reason,
    },
  })
}
