import { prepareBachsRefundRecovery } from '../src/bachs-refund-recovery-preparation'

const base = {
  claim: {
    id: 'claim-1', paymentId: 'payment-1', orderId: 'order-1', provider: 'BACHS',
    currency: 'NGN', refundAmount: 5000, status: 'FAILED_RECONCILED',
    refundContext: {
      version: 'commercial-refund-v1', payment_id: 'payment-1', refund_amount: 5000,
      ledger_entries: [
        { accountCode: 'TAILOR_ENTITLEMENT', accountScope: 'order-1', direction: 'DEBIT', amount: 3000, currency: 'NGN' },
        { accountCode: 'DRAPEON_REVENUE', accountScope: 'order-1', direction: 'DEBIT', amount: 2000, currency: 'NGN' },
        { accountCode: 'PROVIDER_CLEARING', accountScope: 'provider', direction: 'CREDIT', amount: 5000, currency: 'NGN' },
      ],
    },
  },
  payment: {
    id: 'payment-1', orderId: 'order-1', provider: 'BACHS', providerPaymentId: 'pay_test',
    currency: 'NGN', status: 'SUCCEEDED',
  },
  failedAttempt: {
    id: 'attempt-1', status: 'FAILED_RECONCILED',
    providerEvidence: {
      outcome: 'INSUFFICIENT_PLATFORM_REFUND_BALANCE', no_movement: true,
      rejected_status: 400,
    },
  },
  issue: {
    id: 'issue-1', orderId: 'order-1', issueType: 'REFUND_FAILED', status: 'OPEN',
    dedupeKey: 'bachs-refund-review:claim-1',
  },
  destination: {
    provider: 'BACHS', providerAccountRef: 'acct_test', currency: 'NGN',
    active: true, transfersEnabled: true,
  },
  transferredAmount: 3000,
  orderReference: 'DRP12345',
  latestRequest: null,
  confirmation: { orderReference: 'DRP12345', amount: 5000, currency: 'NGN' },
}

describe('Bachs refund recovery preparation', () => {
  it('prepares one exact reviewed recovery for only the tailor allocation', () => {
    const result = prepareBachsRefundRecovery(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.amount).toBe(3000)
    expect(result.idempotencyKey).toBe('bachs-refund-recovery:claim-1')
    expect(result.actionPayload.sourceAccountId).toBe('acct_test')
    expect(result.actionPayload.refundAmount).toBe(5000)
  })

  it('requires provider-confirmed no movement, open case and pinned active destination', () => {
    const invalidCases = [
      { failedAttempt: { ...base.failedAttempt, providerEvidence: { ...base.failedAttempt.providerEvidence, no_movement: false } } },
      { issue: { ...base.issue, status: 'RESOLVED' } },
      { destination: { ...base.destination, active: false } },
      { destination: { ...base.destination, transfersEnabled: false } },
      { transferredAmount: 2999 },
      { latestRequest: { id: 'request-1', status: 'FAILED' } },
    ]
    for (const changed of invalidCases) {
      expect(prepareBachsRefundRecovery({ ...base, ...changed }).ok).toBe(false)
    }
  })

  it('does not recover platform-owned charges or a zero tailor share', () => {
    const noTailorAllocation = {
      ...base,
      claim: {
        ...base.claim,
        refundContext: {
          ...base.claim.refundContext,
          ledger_entries: [
            { accountCode: 'DRAPEON_REVENUE', accountScope: 'order-1', direction: 'DEBIT', amount: 5000, currency: 'NGN' },
            { accountCode: 'PROVIDER_CLEARING', accountScope: 'provider', direction: 'CREDIT', amount: 5000, currency: 'NGN' },
          ],
        },
      },
    }
    expect(prepareBachsRefundRecovery(noTailorAllocation).ok).toBe(false)
  })
})
