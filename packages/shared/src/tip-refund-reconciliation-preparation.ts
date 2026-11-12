export type TipRefundReconciliationSnapshot = {
  tip: { id: string; orderId: string; paymentId: string; amount: number; currency: string; status: string }
  payment: { id: string; orderId: string; provider: string; providerPaymentId: string;
    amount: number; currency: string; status: string; refundedAmount: number }
  claim: { id: string; tipId: string; status: string; fundingMode: string;
    moneyDeskRequestId: string; providerOperationId: string | null }
  oldRequest: { id: string; status: string; actionType: string; targetType: string;
    targetId: string; requiredApprovalCount: number }
  payoutCount: number
  providerRefundCount: number
  refundJournalCount: number
  latestRecovery: { id: string; status: string; idempotencyKey: string } | null
  orderReference: string
  confirmation: { orderReference: string; amount: number; currency: string; providerRefundId: string }
}

export function isTipRecoveryOrderReference(value: string): boolean {
  return value.length <= 80 &&
    (/^DRP[A-Z0-9]+$/u.test(value) || /^DEV-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(value))
}

export function prepareTipRefundReconciliation(input: TipRefundReconciliationSnapshot):
  | { ok: false; code: string }
  | { ok: true; targetId: string; orderId: string; amount: number; currency: string;
      amountUsdEquivalent: number | null; idempotencyKey: string;
      actionPayload: Record<string, string> } {
  const { tip, payment, claim, oldRequest, confirmation, latestRecovery } = input
  if (payment.provider !== 'STRIPE' || !payment.providerPaymentId.startsWith('pi_') ||
      payment.status !== 'SUCCEEDED' || payment.refundedAmount !== 0 ||
      tip.status !== 'HELD' || tip.paymentId !== payment.id || tip.orderId !== payment.orderId ||
      tip.amount !== payment.amount || tip.currency !== payment.currency ||
      claim.tipId !== tip.id || claim.status !== 'RESERVED' ||
      claim.fundingMode !== 'UNPAID_TIP' || claim.providerOperationId !== null ||
      claim.moneyDeskRequestId !== oldRequest.id || oldRequest.status !== 'FAILED' ||
      oldRequest.actionType !== 'CUSTOMER_REFUND' || oldRequest.targetType !== 'ORDER_TIP' ||
      oldRequest.targetId !== tip.id || input.payoutCount !== 0 ||
      input.providerRefundCount !== 0 || input.refundJournalCount !== 0) {
    return { ok: false, code: 'TIP_REFUND_RECOVERY_STATE_MISMATCH' }
  }
  if (confirmation.orderReference !== input.orderReference ||
      confirmation.amount !== tip.amount || confirmation.currency !== tip.currency ||
      !/^re_[A-Za-z0-9]+$/u.test(confirmation.providerRefundId)) {
    return { ok: false, code: 'TIP_REFUND_RECOVERY_CONFIRMATION_MISMATCH' }
  }
  if (latestRecovery?.status === 'SUCCEEDED') {
    return { ok: false, code: 'TIP_REFUND_RECOVERY_ALREADY_COMPLETE' }
  }
  const base = `tip-refund-reconciliation:${tip.id}:${confirmation.providerRefundId}`
  const terminal = latestRecovery && ['FAILED', 'CANCELLED', 'REJECTED'].includes(latestRecovery.status)
  return {
    ok: true,
    targetId: tip.id,
    orderId: tip.orderId,
    amount: tip.amount,
    currency: tip.currency,
    amountUsdEquivalent: tip.currency === 'USD' ? tip.amount : null,
    idempotencyKey: terminal ? `${base}:after:${latestRecovery.id}` :
      latestRecovery?.idempotencyKey ?? base,
    actionPayload: {
      tipId: tip.id,
      paymentId: payment.id,
      paymentIntentId: payment.providerPaymentId,
      refundClaimId: claim.id,
      previousRequestId: oldRequest.id,
      providerRefundId: confirmation.providerRefundId,
    },
  }
}
