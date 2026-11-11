export type FailedRefundJournalPreparation = {
  refund: {
    id: string
    paymentId: string
    provider: string
    providerRefundId: string
    amount: number
    status: string
  }
  payment: {
    id: string
    orderId: string
    provider: string
    providerPaymentId: string
    amount: number
    currency: string
    status: string
  }
  issue: {
    id: string
    orderId: string
    status: string
    issueType: string
    dedupeKey: string
  }
  refundJournalCount: number
  reversalCount: number
  latestRequest: { id: string; status: string; idempotencyKey: string } | null
  orderReference: string
  confirmation: { orderReference: string; amount: number; currency: string }
}

export function reviewedFailedRefundJournalPreparation(input: FailedRefundJournalPreparation):
  | { ok: false; code: string }
  | { ok: true; targetId: string; orderId: string; amount: number; currency: string;
      amountUsdEquivalent: number | null; idempotencyKey: string;
      actionPayload: Record<string, string> } {
  const { refund, payment, issue, latestRequest } = input
  if (refund.provider !== 'STRIPE' || refund.status !== 'FAILED' ||
      payment.provider !== 'STRIPE' || !['SUCCEEDED', 'PARTIAL_REFUND'].includes(payment.status) ||
      refund.paymentId !== payment.id || refund.amount <= 0 || refund.amount > payment.amount ||
      !refund.providerRefundId.startsWith('re_') ||
      !payment.providerPaymentId.startsWith('pi_')) {
    return { ok: false, code: 'FAILED_REFUND_NOT_ELIGIBLE' }
  }
  if (issue.status !== 'OPEN' || issue.issueType !== 'REFUND_FAILED' ||
      issue.orderId !== payment.orderId ||
      !issue.dedupeKey.startsWith(`refund-ledger-missing:${payment.id}:`)) {
    return { ok: false, code: 'LEDGER_MISMATCH_CASE_REQUIRED' }
  }
  if (input.refundJournalCount !== 1 || input.reversalCount !== 0) {
    return { ok: false, code: 'EXACT_UNREVERSED_JOURNAL_REQUIRED' }
  }
  if (input.confirmation.orderReference !== input.orderReference ||
      input.confirmation.amount !== refund.amount ||
      input.confirmation.currency !== payment.currency) {
    return { ok: false, code: 'OPERATOR_AMOUNT_CONFIRMATION_MISMATCH' }
  }
  if (latestRequest?.status === 'SUCCEEDED') {
    return { ok: false, code: 'RECOVERY_REVIEW_ALREADY_EXISTS' }
  }
  const base = `failed-refund-journal-recovery:${refund.id}`
  const terminal = latestRequest && ['FAILED', 'CANCELLED', 'REJECTED'].includes(latestRequest.status)
  return {
    ok: true,
    targetId: refund.id,
    orderId: payment.orderId,
    amount: refund.amount,
    currency: payment.currency,
    amountUsdEquivalent: payment.currency === 'USD' ? refund.amount : null,
    idempotencyKey: terminal ? `${base}:after:${latestRequest.id}` :
      latestRequest?.idempotencyKey ?? base,
    actionPayload: {
      providerRefundId: refund.providerRefundId,
      paymentId: payment.id,
      opsIssueId: issue.id,
    },
  }
}
