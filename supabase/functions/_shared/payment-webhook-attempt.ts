import type { PaymentAttempt } from './payment-ledger.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createOrRefreshOpsIssue } from './ops-issues.ts'
import { markWebhookEventProcessed } from './payment-ledger.ts'
import { providerMinorUnitsMatch } from '../../../packages/shared/src/money-units.ts'

type PaymentProvider = 'STRIPE' | 'PAYSTACK'

export type PaymentWebhookIdentity = {
  orderId?: unknown
  phase?: unknown
  idempotencyKey?: unknown
  materialAdvanceId?: unknown
  currency?: unknown
  amountMinor?: unknown
}

export type MaterialAdvanceWebhookLink = {
  id: string
  order_id: string
  payment_id?: string | null
  payment_provider?: string | null
  provider_payment_id?: string | null
  title?: string | null
  status?: string | null
  paid_at?: string | null
}

export async function resolveMaterialAdvanceWebhookLink(
  supabase: SupabaseClient,
  attempt: PaymentAttempt,
  metadataAdvanceId?: unknown,
): Promise<{ advance: MaterialAdvanceWebhookLink | null; mismatch: string | null }> {
  const columns = 'id,order_id,payment_id,payment_provider,provider_payment_id,title,status,paid_at'
  const [byProviderPayment, byAttempt] = await Promise.all([
    attempt.provider_payment_id
      ? supabase.from('order_material_advances').select(columns).eq('order_id', attempt.order_id)
        .eq('payment_provider', attempt.provider).eq('provider_payment_id', attempt.provider_payment_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('order_material_advances').select(columns).eq('order_id', attempt.order_id)
      .eq('payment_id', attempt.id).maybeSingle(),
  ])
  if (byProviderPayment.error) throw byProviderPayment.error
  if (byAttempt.error) throw byAttempt.error

  // Provider metadata is untrusted and the UUID cast in Postgres can itself fail
  // for malformed metadata. Resolve only from the attempt's durable references;
  // then compare the optional metadata ID against that canonical row below.
  const candidates = [byProviderPayment.data, byAttempt.data]
    .filter((value) => value !== null) as MaterialAdvanceWebhookLink[]
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()]
  if (uniqueCandidates.length > 1) return { advance: null, mismatch: 'material_advance_link_ambiguous' }

  const advance = uniqueCandidates[0] ?? null
  const mismatch = materialAdvanceWebhookLinkMismatch(attempt, advance, metadataAdvanceId)
  return { advance, mismatch }
}

/** A material payment must resolve to the advance linked to this exact attempt. */
export function materialAdvanceWebhookLinkMismatch(
  attempt: PaymentAttempt,
  advance: MaterialAdvanceWebhookLink | null,
  metadataAdvanceId?: unknown,
): string | null {
  if (attempt.phase !== 'MATERIAL_ADVANCE') return 'phase'
  if (!advance) return 'material_advance_missing'
  if (advance.order_id !== attempt.order_id) return 'material_advance_order_id'
  if (advance.payment_id && advance.payment_id !== attempt.id) return 'material_advance_payment_attempt'
  if (advance.payment_provider && advance.payment_provider !== attempt.provider) return 'material_advance_provider'
  if (advance.provider_payment_id && advance.provider_payment_id !== attempt.provider_payment_id) return 'material_advance_provider_payment_id'
  if (!advance.payment_id && !advance.provider_payment_id) return 'material_advance_unlinked'
  if (metadataAdvanceId !== undefined && metadataAdvanceId !== null) {
    if (typeof metadataAdvanceId !== 'string' || !metadataAdvanceId.trim() || metadataAdvanceId.trim() !== advance.id) {
      return 'material_advance_id'
    }
  }
  return null
}

/** Provider metadata is an assertion, never the source of order or phase. */
export function paymentWebhookAttemptMismatch(
  attempt: PaymentAttempt,
  identity: PaymentWebhookIdentity,
): string | null {
  if (identity.orderId !== undefined && identity.orderId !== null) {
    if (typeof identity.orderId !== 'string' || !identity.orderId.trim() || identity.orderId.trim() !== attempt.order_id) return 'order_id'
  }
  if (identity.phase !== undefined && identity.phase !== null) {
    if (typeof identity.phase !== 'string' || !identity.phase.trim() || identity.phase.trim() !== attempt.phase) return 'phase'
  }
  if (identity.idempotencyKey !== undefined && identity.idempotencyKey !== null) {
    if (
      typeof identity.idempotencyKey !== 'string' || !identity.idempotencyKey.trim() ||
      identity.idempotencyKey.trim() !== attempt.idempotency_key
    ) {
      return 'idempotency_key'
    }
  }
  if (attempt.phase === 'MATERIAL_ADVANCE' && identity.materialAdvanceId !== undefined && identity.materialAdvanceId !== null) {
    const storedMaterialAdvanceId = typeof attempt.provider_response?.material_advance_id === 'string'
      ? attempt.provider_response.material_advance_id.trim()
      : ''
    if (
      typeof identity.materialAdvanceId !== 'string' || !identity.materialAdvanceId.trim() ||
      (storedMaterialAdvanceId && identity.materialAdvanceId.trim() !== storedMaterialAdvanceId)
    ) return 'material_advance_id'
  }
  if (typeof identity.currency !== 'string' || identity.currency.trim().toUpperCase() !== attempt.currency.toUpperCase()) {
    return 'currency'
  }
  if (!providerMinorUnitsMatch(attempt.amount, identity.amountMinor, attempt.currency)) return 'amount'
  return null
}

/** Dispute amounts may be partial, but cannot exceed the captured attempt or change currency. */
export function disputeMatchesPaymentAttempt(
  attempt: PaymentAttempt | null,
  amountMinor: unknown,
  currency: unknown,
): boolean {
  return !!attempt && typeof currency === 'string' &&
    currency.trim().toUpperCase() === attempt.currency.toUpperCase() &&
    Number.isSafeInteger(amountMinor) && (amountMinor as number) > 0 &&
    (amountMinor as number) <= attempt.amount
}

export type DisputeAssociation = {
  paymentId: string | null
  orderId: string | null
  customerId: string | null
  tailorId: string | null
  reconciled: boolean
}

/** Preserve established linkage on an untrusted update, without declaring it reconciled. */
export function resolveDisputeAssociation(
  matchedPayment: Pick<PaymentAttempt, 'id' | 'order_id'> | null,
  order: { id: string; customer_id: string | null; tailor_id: string | null } | null,
  previous: DisputeAssociation,
): DisputeAssociation {
  if (matchedPayment && order && matchedPayment.order_id === order.id) {
    return {
      paymentId: matchedPayment.id,
      orderId: order.id,
      customerId: order.customer_id,
      tailorId: order.tailor_id,
      reconciled: true,
    }
  }
  return { ...previous, reconciled: false }
}

export function shouldBlockDisputeMoneyMovement(reconciled: boolean, terminalRelease: boolean): boolean {
  return !reconciled || !terminalRelease
}

export async function recordPaymentWebhookIdentityReview(
  supabase: SupabaseClient,
  input: {
    provider: PaymentProvider
    providerPaymentId: string
    eventType: string
    webhookEventId: string
    attempt: PaymentAttempt | null
    mismatch: string | null
  },
) {
  const issue = await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYMENT_BLOCKED',
    severity: 'HIGH',
    source: `${input.provider.toLowerCase()}-webhook`,
    actorRole: 'SYSTEM',
    orderId: input.attempt?.order_id ?? null,
    provider: input.provider,
    title: input.attempt ? 'Payment webhook identity mismatch' : 'Received payment without a linked attempt',
    description: 'A signed provider payment event needs Money Desk reconciliation before any order transition.',
    recommendedAction: 'Compare the provider event with the stored payment attempt. Record or refund any real charge through the reviewed money flow.',
    dedupeKey: `${input.provider.toLowerCase()}-payment-attempt-review:${input.providerPaymentId}:${input.mismatch ?? 'missing'}`,
    relatedEntityType: 'order_payment',
    relatedEntityId: input.attempt?.id ?? input.providerPaymentId,
    queueKey: 'money-desk',
    persistWhenRoutineDisabled: true,
    metadata: {
      provider_payment_id: input.providerPaymentId,
      provider_event_type: input.eventType,
      mismatch_field: input.mismatch,
    },
  })
  if (!issue?.id) throw new Error(`Could not persist ${input.provider} payment identity review case`)

  const processingResult = input.mismatch
    ? `payment_attempt_mismatch:${input.mismatch}`
    : 'payment_attempt_missing_review'
  await markWebhookEventProcessed(supabase, input.webhookEventId, {
    orderId: input.attempt?.order_id ?? null,
    paymentId: input.attempt?.id ?? null,
    processingResult,
    reconciliationRequired: true,
  })
  return processingResult
}
