import { prepareTipRefundReconciliation, type TipRefundReconciliationSnapshot } from '../tip-refund-reconciliation-preparation'

const snapshot: TipRefundReconciliationSnapshot = {
  tip: { id: 'tip-one', orderId: 'order-one', paymentId: 'payment-one', amount: 500,
    currency: 'USD', status: 'HELD' },
  payment: { id: 'payment-one', orderId: 'order-one', provider: 'STRIPE',
    providerPaymentId: 'pi_one', amount: 500, currency: 'USD', status: 'SUCCEEDED', refundedAmount: 0 },
  claim: { id: 'claim-one', tipId: 'tip-one', status: 'RESERVED', fundingMode: 'UNPAID_TIP',
    moneyDeskRequestId: 'old-one', providerOperationId: null },
  oldRequest: { id: 'old-one', status: 'FAILED', actionType: 'CUSTOMER_REFUND',
    targetType: 'ORDER_TIP', targetId: 'tip-one', requiredApprovalCount: 1 },
  payoutCount: 0, providerRefundCount: 0, refundJournalCount: 0,
  latestRecovery: null, orderReference: 'DRPTESTONE',
  confirmation: { orderReference: 'DRPTESTONE', amount: 500, currency: 'USD', providerRefundId: 're_one' },
}

test('prepares a distinct two-person recovery target without any provider send', () => {
  expect(prepareTipRefundReconciliation(snapshot)).toEqual({
    ok: true, targetId: 'tip-one', orderId: 'order-one', amount: 500,
    currency: 'USD', amountUsdEquivalent: 500,
    idempotencyKey: 'tip-refund-reconciliation:tip-one:re_one',
    actionPayload: { tipId: 'tip-one', paymentId: 'payment-one', paymentIntentId: 'pi_one',
      refundClaimId: 'claim-one', previousRequestId: 'old-one', providerRefundId: 're_one' },
  })
})

test.each([
  ['payout exists', { payoutCount: 1 }],
  ['provider refund already recorded', { providerRefundCount: 1 }],
  ['journal already recorded', { refundJournalCount: 1 }],
  ['claim already moved', { claim: { ...snapshot.claim, status: 'SUCCEEDED' } }],
  ['old request is active', { oldRequest: { ...snapshot.oldRequest, status: 'EXECUTING' } }],
  ['payment already refunded', { payment: { ...snapshot.payment, refundedAmount: 500 } }],
])('refuses preparation when %s', (_, change) => {
  expect(prepareTipRefundReconciliation({ ...snapshot, ...change })).toEqual({
    ok: false, code: 'TIP_REFUND_RECOVERY_STATE_MISMATCH',
  })
})

test('requires the operator to match the exact order and provider refund', () => {
  expect(prepareTipRefundReconciliation({ ...snapshot,
    confirmation: { ...snapshot.confirmation, amount: 400 } })).toEqual({
    ok: false, code: 'TIP_REFUND_RECOVERY_CONFIRMATION_MISMATCH',
  })
  expect(prepareTipRefundReconciliation({ ...snapshot,
    confirmation: { ...snapshot.confirmation, providerRefundId: 'pi_wrong' } })).toEqual({
    ok: false, code: 'TIP_REFUND_RECOVERY_CONFIRMATION_MISMATCH',
  })
})

test('double submit dedupes and a failed recovery can start a new review', () => {
  const key = 'tip-refund-reconciliation:tip-one:re_one'
  expect(prepareTipRefundReconciliation({ ...snapshot, latestRecovery: {
    id: 'review-one', status: 'PENDING_APPROVAL', idempotencyKey: key,
  } })).toMatchObject({ ok: true, idempotencyKey: key })
  expect(prepareTipRefundReconciliation({ ...snapshot, latestRecovery: {
    id: 'review-one', status: 'FAILED', idempotencyKey: key,
  } })).toMatchObject({ ok: true, idempotencyKey: `${key}:after:review-one` })
  expect(prepareTipRefundReconciliation({ ...snapshot, latestRecovery: {
    id: 'review-one', status: 'SUCCEEDED', idempotencyKey: key,
  } })).toEqual({ ok: false, code: 'TIP_REFUND_RECOVERY_ALREADY_COMPLETE' })
})
