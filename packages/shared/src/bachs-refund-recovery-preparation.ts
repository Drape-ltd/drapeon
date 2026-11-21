export type BachsRefundRecoveryPreparationInput = {
  claim: {
    id: string
    paymentId: string
    orderId: string
    provider: string
    currency: string
    refundAmount: number
    status: string
    refundContext: unknown
  }
  payment: {
    id: string
    orderId: string
    provider: string
    providerPaymentId: string | null
    currency: string
    status: string
  }
  failedAttempt: {
    id: string
    status: string
    providerEvidence: unknown
  }
  issue: {
    id: string
    orderId: string | null
    issueType: string
    status: string
    dedupeKey: string | null
  }
  destination: {
    provider: string
    providerAccountRef: string
    currency: string
    active: boolean
    transfersEnabled: boolean
  }
  transferredAmount: number
  orderReference: string
  latestRequest: { id: string; status: string } | null
  confirmation: { orderReference: string; amount: number; currency: string }
}

export type BachsRefundRecoveryPreparation = {
  ok: true
  targetId: string
  orderId: string
  amount: number
  currency: string
  idempotencyKey: string
  actionPayload: Record<string, unknown>
} | {
  ok: false
  code: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Freeze the transfer to the exact no-movement refund claim and payout account. */
export function prepareBachsRefundRecovery(
  input: BachsRefundRecoveryPreparationInput,
): BachsRefundRecoveryPreparation {
  const { claim, payment, failedAttempt, issue, destination, confirmation } = input
  const context = record(claim.refundContext)
  const entries = Array.isArray(context.ledger_entries) ? context.ledger_entries : []
  const evidence = record(failedAttempt.providerEvidence)

  if (!claim.id || claim.provider !== 'BACHS' || claim.status !== 'FAILED_RECONCILED' ||
    claim.currency !== 'NGN' || !Number.isSafeInteger(claim.refundAmount) || claim.refundAmount <= 0 ||
    context.version !== 'commercial-refund-v1' || context.payment_id !== claim.paymentId ||
    context.refund_amount !== claim.refundAmount || entries.length < 2) {
    return { ok: false, code: 'REFUND_CLAIM_NOT_RECOVERABLE' }
  }
  if (payment.id !== claim.paymentId || payment.orderId !== claim.orderId ||
    payment.provider !== 'BACHS' || payment.currency !== claim.currency ||
    !['SUCCEEDED', 'PARTIAL_REFUND'].includes(payment.status) ||
    !payment.providerPaymentId || !/^(?:chk|pay)_[A-Za-z0-9_-]+$/u.test(payment.providerPaymentId)) {
    return { ok: false, code: 'REFUND_PAYMENT_MISMATCH' }
  }
  if (failedAttempt.status !== 'FAILED_RECONCILED' ||
    evidence.outcome !== 'INSUFFICIENT_PLATFORM_REFUND_BALANCE' ||
    evidence.no_movement !== true || evidence.rejected_status !== 400) {
    return { ok: false, code: 'NO_CONFIRMED_NO_MOVEMENT_EVIDENCE' }
  }
  if (issue.issueType !== 'REFUND_FAILED' || issue.orderId !== claim.orderId ||
    issue.status !== 'OPEN' || issue.dedupeKey !== `bachs-refund-review:${claim.id}`) {
    return { ok: false, code: 'REFUND_CASE_MISMATCH' }
  }
  if (destination.provider !== 'BACHS' || !/^acct_[A-Za-z0-9_-]+$/u.test(destination.providerAccountRef) ||
    destination.currency !== claim.currency || !destination.active || !destination.transfersEnabled) {
    return { ok: false, code: 'PINNED_BACHS_DESTINATION_UNAVAILABLE' }
  }
  if (input.orderReference !== confirmation.orderReference ||
    confirmation.amount !== claim.refundAmount || confirmation.currency !== claim.currency) {
    return { ok: false, code: 'REFUND_CONFIRMATION_MISMATCH' }
  }
  if (input.latestRequest) return { ok: false, code: 'RECOVERY_ALREADY_REQUESTED' }

  let amount = 0
  for (const rawEntry of entries) {
    const entry = record(rawEntry)
    if (entry.direction !== 'DEBIT' ||
      !['TAILOR_ENTITLEMENT', 'TAILOR_ELIGIBLE'].includes(String(entry.accountCode)) ||
      entry.currency !== claim.currency || !Number.isSafeInteger(entry.amount) || Number(entry.amount) < 0) {
      continue
    }
    amount += Number(entry.amount)
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, code: 'NO_TAILOR_REFUND_ALLOCATION' }
  }
  if (!Number.isSafeInteger(input.transferredAmount) || input.transferredAmount < amount) {
    return { ok: false, code: 'NO_MATCHING_CONFIRMED_TAILOR_TRANSFER' }
  }

  return {
    ok: true,
    targetId: claim.id,
    orderId: claim.orderId,
    amount,
    currency: claim.currency,
    idempotencyKey: `bachs-refund-recovery:${claim.id}`,
    actionPayload: {
      kind: 'BACHS_REFUND_RECOVERY_V1',
      refundClaimId: claim.id,
      paymentId: payment.id,
      providerPaymentId: payment.providerPaymentId,
      failedAttemptId: failedAttempt.id,
      opsIssueId: issue.id,
      sourceAccountId: destination.providerAccountRef,
      refundAmount: claim.refundAmount,
      recoveryAmount: amount,
      currency: claim.currency,
      orderReference: input.orderReference,
    },
  }
}
