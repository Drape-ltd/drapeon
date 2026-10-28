import { bachsAmountMinor } from './bachs.ts'

/** Checkout phases whose Bachs money path is currently wired end to end. */
export function isBachsCheckoutPhaseReady(phase: string): boolean {
  return phase === 'INITIAL_ORDER' || phase === 'FULFILLMENT'
}

export type BachsCollectionSucceeded = {
  id: string
  type: 'collection.succeeded'
  organization_id: string
  account?: string
  data: {
    checkout_id: string | null
    charge_id: string | null
    reference: string | null
    status: string
    amount: string
    currency: string
    settlement_amount?: string | null
    settlement_currency?: string | null
    processing_fee?: string | null
    processing_fee_currency?: string | null
  }
}

type LinkedAttempt = {
  provider: string
  provider_payment_id: string | null
  provider_charge_id?: string | null
  idempotency_key: string
  currency: string
  amount: number
}

/** A signed event is still only a hint until its exact saved attempt matches. */
export function matchBachsCollection(input: {
  event: BachsCollectionSucceeded
  attempt: LinkedAttempt | null
  platformAccountId: string
}): { outcome: 'MATCH'; chargeId: string; settledMinor: number | null; feeMinor: number | null } | {
  outcome: 'UNMATCHED' | 'IDENTITY_CONFLICT' | 'UNRECONCILABLE'
} {
  const { event, attempt } = input
  if (event.type !== 'collection.succeeded' || event.data.status !== 'SUCCEEDED') return { outcome: 'UNRECONCILABLE' }
  if (event.organization_id !== input.platformAccountId || event.account) return { outcome: 'IDENTITY_CONFLICT' }
  if (!event.data.checkout_id?.startsWith('chk_') || !event.data.charge_id?.startsWith('ch_')) {
    return { outcome: 'UNRECONCILABLE' }
  }
  if (!attempt) return { outcome: 'UNMATCHED' }
  if (attempt.provider !== 'BACHS' || attempt.provider_payment_id !== event.data.checkout_id ||
    (attempt.provider_charge_id && attempt.provider_charge_id !== event.data.charge_id) ||
    attempt.idempotency_key !== event.data.reference || attempt.currency !== event.data.currency) {
    return { outcome: 'IDENTITY_CONFLICT' }
  }
  try {
    if (bachsAmountMinor(event.data.amount, event.data.currency) !== attempt.amount) return { outcome: 'IDENTITY_CONFLICT' }
    const settledMinor = event.data.settlement_amount == null ? null : bachsAmountMinor(event.data.settlement_amount, event.data.settlement_currency ?? '')
    const feeMinor = event.data.processing_fee == null ? null : bachsAmountMinor(event.data.processing_fee, event.data.processing_fee_currency ?? '')
    if (settledMinor != null && (settledMinor < 0 || event.data.settlement_currency !== event.data.currency)) {
      return { outcome: 'IDENTITY_CONFLICT' }
    }
    if (feeMinor != null && (feeMinor < 0 || event.data.processing_fee_currency !== event.data.currency)) {
      return { outcome: 'IDENTITY_CONFLICT' }
    }
    return { outcome: 'MATCH', chargeId: event.data.charge_id, settledMinor, feeMinor }
  } catch {
    return { outcome: 'IDENTITY_CONFLICT' }
  }
}

export function bachsInitialCollectionReviewReason(input: {
  attemptOrderId: string | null | undefined
  orderId: string
  attemptPhase: string
  attemptStatus: string
  orderStage: string
  paymentProvider: string | null
  paymentCheckoutId: string | null
  succeededCheckoutId: string
  acceptedSnapshotAt: string | null
  snapshotProvider: string | null
  snapshotCurrency: string | null
  paymentCurrency: string
}): string | null {
  if (!input.attemptOrderId) return 'payment_attempt_missing'
  if (input.attemptOrderId !== input.orderId) return 'payment_attempt_order_mismatch'
  if (input.attemptPhase !== 'INITIAL_ORDER') return 'payment_attempt_phase_mismatch'
  if (!input.acceptedSnapshotAt || input.snapshotProvider !== 'BACHS' || input.snapshotCurrency !== input.paymentCurrency) {
    return 'accepted_route_snapshot_mismatch'
  }
  if (input.paymentProvider !== 'BACHS' || input.paymentCheckoutId !== input.succeededCheckoutId) {
    return 'payment_reference_not_current'
  }
  if (input.attemptStatus === 'FAILED' || input.attemptStatus === 'CANCELED') return 'late_success_after_terminal_attempt'
  if (!['PAYMENT_PENDING', 'CONFIRMED'].includes(input.orderStage)) return 'order_not_payable'
  return null
}

export function bachsFollowupCollectionReviewReason(input: {
  attemptOrderId: string | null | undefined
  orderId: string
  attemptPhase: string
  attemptStatus: string
  orderStage: string
  paymentProvider: string | null
  paymentCheckoutId: string | null
  succeededCheckoutId: string
  acceptedSnapshotAt: string | null
  snapshotProvider: string | null
  snapshotCurrency: string | null
  paymentCurrency: string
  paymentAmount: number
  expectedAmount: number | null
  phasePaymentProvider: string | null
  phasePaymentCheckoutId: string | null
  consultationBookingId?: string | null
  consultationBookingLinkSource?: string | null
  consultationPaymentTiming?: string | null
  fulfillmentPaymentRequestedAt?: string | null
  fulfillmentDeliveryMethod?: string | null
  fulfillmentPaymentPaidAt?: string | null
}): string | null {
  if (!input.attemptOrderId) return 'payment_attempt_missing'
  if (input.attemptOrderId !== input.orderId) return 'payment_attempt_order_mismatch'
  if (input.attemptPhase !== 'CONSULTATION' && input.attemptPhase !== 'FULFILLMENT') {
    return 'payment_attempt_phase_not_supported'
  }
  if (!input.acceptedSnapshotAt || input.snapshotProvider !== 'BACHS'
    || input.snapshotCurrency !== input.paymentCurrency) {
    return 'accepted_route_snapshot_mismatch'
  }
  if (input.phasePaymentProvider !== 'BACHS'
    || input.phasePaymentCheckoutId !== input.succeededCheckoutId) {
    return 'payment_reference_not_current'
  }
  if (input.paymentProvider !== 'BACHS') return 'payment_provider_snapshot_mismatch'
  if (input.attemptStatus === 'FAILED' || input.attemptStatus === 'CANCELED') {
    return 'late_success_after_terminal_attempt'
  }
  if (input.expectedAmount == null || input.expectedAmount !== input.paymentAmount) {
    return 'phase_payment_amount_mismatch'
  }
  if (input.attemptPhase === 'CONSULTATION' && input.orderStage !== 'CONSULTATION') {
    return 'consultation_order_not_payable'
  }
  if (input.attemptPhase === 'CONSULTATION' && !input.consultationBookingId) {
    return 'consultation_booking_link_missing'
  }
  if (input.attemptPhase === 'CONSULTATION' && input.consultationBookingLinkSource !== 'PREPARED') {
    return 'consultation_booking_link_not_prepared'
  }
  if (input.attemptPhase === 'CONSULTATION' && input.consultationPaymentTiming !== 'BEFORE_CALL_STARTS') {
    return 'consultation_payment_not_due'
  }
  if (input.attemptPhase === 'FULFILLMENT'
    && !input.fulfillmentPaymentPaidAt
    && !['FINISHING', 'READY_FOR_DRAPE_DISPATCH'].includes(input.orderStage)) {
    return 'fulfillment_payment_order_not_payable'
  }
  if (input.attemptPhase === 'FULFILLMENT'
    && input.fulfillmentDeliveryMethod === 'LOCAL_COLLECTION') {
    return 'fulfillment_payment_not_applicable'
  }
  if (input.attemptPhase === 'FULFILLMENT'
    && !input.fulfillmentPaymentPaidAt
    && !input.fulfillmentPaymentRequestedAt) {
    return 'fulfillment_payment_not_requested'
  }
  return null
}
