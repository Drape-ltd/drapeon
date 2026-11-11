import { reviewedFailedRefundJournalPreparation, type FailedRefundJournalPreparation } from '../failed-refund-journal-preparation'

const base: FailedRefundJournalPreparation = {
  refund: { id: 'refund-uuid', paymentId: 'payment-uuid', provider: 'STRIPE',
    providerRefundId: 're_failed', amount: 15500, status: 'FAILED' },
  payment: { id: 'payment-uuid', orderId: 'order-id', provider: 'STRIPE',
    providerPaymentId: 'pi_paid', amount: 15500, currency: 'USD', status: 'SUCCEEDED' },
  issue: { id: 'issue-uuid', orderId: 'order-id', status: 'OPEN',
    issueType: 'REFUND_FAILED', dedupeKey: 'refund-ledger-missing:payment-uuid:15500:15500',
    userId: null },
  refundJournalCount: 1,
  reversalCount: 0,
  latestRequest: null,
  orderReference: 'DRPTEST',
  confirmation: { orderReference: 'DRPTEST', amount: 15500, currency: 'USD' },
}

describe('reviewed failed refund journal preparation', () => {
  it('snapshots the exact failed refund and case for independent approval', () => {
    expect(reviewedFailedRefundJournalPreparation(base)).toEqual({
      ok: true, targetId: 'refund-uuid', orderId: 'order-id', amount: 15500,
      currency: 'USD', amountUsdEquivalent: 15500,
      idempotencyKey: 'failed-refund-journal-recovery:refund-uuid',
      actionPayload: { providerRefundId: 're_failed', paymentId: 'payment-uuid', opsIssueId: 'issue-uuid' },
    })
  })
  it('permits a new review only after a terminal failed review', () => {
    expect(reviewedFailedRefundJournalPreparation({ ...base,
      latestRequest: { id: 'failed-uuid', status: 'FAILED', idempotencyKey: 'old-key' } })).toMatchObject({
      ok: true, idempotencyKey: 'failed-refund-journal-recovery:refund-uuid:after:failed-uuid',
    })
    expect(reviewedFailedRefundJournalPreparation({ ...base,
      latestRequest: { id: 'active-uuid', status: 'APPROVED', idempotencyKey: 'active-key' } })).toMatchObject({
      ok: true, idempotencyKey: 'active-key',
    })
    expect(reviewedFailedRefundJournalPreparation({ ...base,
      latestRequest: { id: 'done-uuid', status: 'SUCCEEDED', idempotencyKey: 'done-key' } })).toEqual({
      ok: false, code: 'RECOVERY_REVIEW_ALREADY_EXISTS',
    })
  })
  it('rejects an unrelated case, absent journal, or existing reversal', () => {
    expect(reviewedFailedRefundJournalPreparation({ ...base,
      issue: { ...base.issue, dedupeKey: 'stripe-refund-failed:re_failed' } })).toEqual({
      ok: false, code: 'LEDGER_MISMATCH_CASE_REQUIRED',
    })
    expect(reviewedFailedRefundJournalPreparation({ ...base,
      issue: { ...base.issue, userId: 'customer-uuid' } })).toEqual({
      ok: false, code: 'LEDGER_MISMATCH_CASE_REQUIRED',
    })
    expect(reviewedFailedRefundJournalPreparation({ ...base,
      refundJournalCount: 0 })).toEqual({
      ok: false, code: 'EXACT_UNREVERSED_JOURNAL_REQUIRED',
    })
    expect(reviewedFailedRefundJournalPreparation({ ...base,
      reversalCount: 1 })).toEqual({
      ok: false, code: 'EXACT_UNREVERSED_JOURNAL_REQUIRED',
    })
  })
  it('requires the operator to confirm the exact order and money amount', () => {
    expect(reviewedFailedRefundJournalPreparation({ ...base,
      confirmation: { ...base.confirmation, amount: 15499 } })).toEqual({
      ok: false, code: 'OPERATOR_AMOUNT_CONFIRMATION_MISMATCH',
    })
    expect(reviewedFailedRefundJournalPreparation({ ...base,
      confirmation: { ...base.confirmation, orderReference: 'DRPOTHER' } })).toEqual({
      ok: false, code: 'OPERATOR_AMOUNT_CONFIRMATION_MISMATCH',
    })
  })
})
