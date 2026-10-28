import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { bachsInitialCollectionReviewReason, matchBachsCollection, type BachsCollectionSucceeded } from './bachs-collection.ts'

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
