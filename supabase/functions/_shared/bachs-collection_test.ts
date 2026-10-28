import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { bachsFollowupCollectionReviewReason, bachsInitialCollectionReviewReason, isBachsCheckoutPhaseReady, matchBachsCollection, type BachsCollectionSucceeded } from './bachs-collection.ts'
import { paymentRouteCardIssuerAllowed } from '../../../packages/shared/src/currency-config.ts'

const event: BachsCollectionSucceeded = {
  id: 'evt_test', type: 'collection.succeeded', organization_id: 'acct_platform',
  data: {
    checkout_id: 'chk_test', charge_id: 'ch_test', reference: 'payment:test', status: 'SUCCEEDED',
    amount: '7000.01', currency: 'NGN', settlement_amount: '6930.01', settlement_currency: 'NGN', processing_fee: '70.00', processing_fee_currency: 'NGN',
  },
}
const attempt = {
  provider: 'BACHS', provider_payment_id: 'chk_test', provider_charge_id: null,
  idempotency_key: 'payment:test', currency: 'NGN', amount: 700001,
}

Deno.test('Bachs checkout is closed for phases without a complete payout path', () => {
  assertEquals(isBachsCheckoutPhaseReady('INITIAL_ORDER'), true)
  assertEquals(isBachsCheckoutPhaseReady('FULFILLMENT'), true)
  for (const phase of ['CONSULTATION', 'MATERIAL_ADVANCE', 'TIP', 'ADJUSTMENT']) {
    assertEquals(isBachsCheckoutPhaseReady(phase), false)
  }
})

Deno.test('Bachs issuer enforcement can only block the checkout handoff, not quote acceptance', () => {
  assertEquals(paymentRouteCardIssuerAllowed({
    provider: 'BACHS', confirmedCardIssuerCountries: [], cardIssuerCountryCode: null,
  }), true)
  assertEquals(paymentRouteCardIssuerAllowed({
    provider: 'BACHS', confirmedCardIssuerCountries: [], cardIssuerCountryCode: null,
    enforceCardIssuerCountryGate: true,
  }), false)
})

Deno.test('Bachs collection matches exact checkout, charge, reference and minor units', () => {
  assertEquals(matchBachsCollection({ event, attempt, platformAccountId: 'acct_platform' }), {
    outcome: 'MATCH', chargeId: 'ch_test', settledMinor: 693001, feeMinor: 7000,
  })
})

Deno.test('Bachs collection never matches by order metadata or approximate amount', () => {
  assertEquals(matchBachsCollection({ event, attempt: null, platformAccountId: 'acct_platform' }).outcome, 'UNMATCHED')
  assertEquals(matchBachsCollection({ event, attempt: { ...attempt, amount: 70000100 }, platformAccountId: 'acct_platform' }).outcome, 'IDENTITY_CONFLICT')
  assertEquals(matchBachsCollection({ event, attempt: { ...attempt, idempotency_key: 'another' }, platformAccountId: 'acct_platform' }).outcome, 'IDENTITY_CONFLICT')
})

Deno.test('Bachs collection from a connected account or without a charge fails closed', () => {
  assertEquals(matchBachsCollection({ event: { ...event, account: 'acct_tailor' }, attempt, platformAccountId: 'acct_platform' }).outcome, 'IDENTITY_CONFLICT')
  assertEquals(matchBachsCollection({ event: { ...event, data: { ...event.data, charge_id: null } }, attempt, platformAccountId: 'acct_platform' }).outcome, 'UNRECONCILABLE')
})

Deno.test('Bachs initial collection applies late success but requires Ops review', () => {
  const base = {
    attemptOrderId: 'order-1', orderId: 'order-1', attemptPhase: 'INITIAL_ORDER', attemptStatus: 'PENDING',
    orderStage: 'PAYMENT_PENDING', paymentProvider: 'BACHS', paymentCheckoutId: 'chk_test',
    succeededCheckoutId: 'chk_test', acceptedSnapshotAt: '2026-10-26T12:00:00.000Z',
    snapshotProvider: 'BACHS', snapshotCurrency: 'NGN', paymentCurrency: 'NGN',
  }
  assertEquals(bachsInitialCollectionReviewReason(base), null)
  assertEquals(bachsInitialCollectionReviewReason({ ...base, attemptStatus: 'FAILED' }), 'late_success_after_terminal_attempt')
  assertEquals(bachsInitialCollectionReviewReason({ ...base, attemptStatus: 'CANCELED' }), 'late_success_after_terminal_attempt')
  assertEquals(bachsInitialCollectionReviewReason({ ...base, attemptPhase: 'TIP' }), 'payment_attempt_phase_mismatch')
  assertEquals(bachsInitialCollectionReviewReason({ ...base, snapshotCurrency: 'USD' }), 'accepted_route_snapshot_mismatch')
  assertEquals(bachsInitialCollectionReviewReason({ ...base, paymentCheckoutId: 'chk_old' }), 'payment_reference_not_current')
  assertEquals(bachsInitialCollectionReviewReason({ ...base, orderStage: 'CANCELLED' }), 'order_not_payable')
  assertEquals(bachsInitialCollectionReviewReason({ ...base, attemptOrderId: 'order-other' }), 'payment_attempt_order_mismatch')
})

Deno.test('Bachs consultation success requires the pinned booking checkout and exact amount', () => {
  const base = {
    attemptOrderId: 'order-1', orderId: 'order-1', attemptPhase: 'CONSULTATION',
    attemptStatus: 'PENDING', orderStage: 'CONSULTATION', paymentProvider: 'BACHS',
    paymentCheckoutId: 'chk_test', succeededCheckoutId: 'chk_test',
    acceptedSnapshotAt: '2026-10-26T12:00:00.000Z', snapshotProvider: 'BACHS',
    snapshotCurrency: 'NGN', paymentCurrency: 'NGN', paymentAmount: 25000,
    expectedAmount: 25000, phasePaymentProvider: 'BACHS', phasePaymentCheckoutId: 'chk_test',
    consultationBookingId: 'booking-1', consultationBookingLinkSource: 'PREPARED',
    consultationPaymentTiming: 'BEFORE_CALL_STARTS',
  }
  assertEquals(bachsFollowupCollectionReviewReason(base), null)
  assertEquals(bachsFollowupCollectionReviewReason({ ...base, expectedAmount: 30000 }), 'phase_payment_amount_mismatch')
  assertEquals(bachsFollowupCollectionReviewReason({ ...base, attemptStatus: 'CANCELED' }), 'late_success_after_terminal_attempt')
  assertEquals(bachsFollowupCollectionReviewReason({ ...base, consultationBookingId: null }), 'consultation_booking_link_missing')
  assertEquals(bachsFollowupCollectionReviewReason({ ...base, consultationBookingLinkSource: 'REVIEW' }), 'consultation_booking_link_not_prepared')
  assertEquals(bachsFollowupCollectionReviewReason({ ...base, consultationPaymentTiming: 'AFTER_DELIVERY' }), 'consultation_payment_not_due')
})

Deno.test('Bachs fulfillment success cannot advance an order before its delivery charge is requested', () => {
  const base = {
    attemptOrderId: 'order-1', orderId: 'order-1', attemptPhase: 'FULFILLMENT',
    attemptStatus: 'PENDING', orderStage: 'PRODUCTION', paymentProvider: 'BACHS',
    paymentCheckoutId: 'chk_test', succeededCheckoutId: 'chk_test',
    acceptedSnapshotAt: '2026-10-26T12:00:00.000Z', snapshotProvider: 'BACHS',
    snapshotCurrency: 'NGN', paymentCurrency: 'NGN', paymentAmount: 5000,
    expectedAmount: 5000, phasePaymentProvider: 'BACHS', phasePaymentCheckoutId: 'chk_test',
    fulfillmentPaymentRequestedAt: '2026-10-27T12:00:00.000Z',
    fulfillmentDeliveryMethod: 'COURIER', fulfillmentPaymentPaidAt: null,
  }
  assertEquals(bachsFollowupCollectionReviewReason(base), 'fulfillment_payment_order_not_payable')
  assertEquals(bachsFollowupCollectionReviewReason({ ...base, orderStage: 'FINISHING' }), null)
  assertEquals(bachsFollowupCollectionReviewReason({ ...base, orderStage: 'FINISHING', fulfillmentPaymentRequestedAt: null }), 'fulfillment_payment_not_requested')
  assertEquals(bachsFollowupCollectionReviewReason({ ...base, orderStage: 'FINISHING', fulfillmentDeliveryMethod: 'LOCAL_COLLECTION' }), 'fulfillment_payment_not_applicable')
})
