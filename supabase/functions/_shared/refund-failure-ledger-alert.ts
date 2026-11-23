type Provider = 'STRIPE' | 'BACHS'

export function refundFailureLedgerBlockedIssue(input: {
  provider: Provider
  source: string
  orderId: string
  paymentId: string
  refundId: string
}) {
  return {
    issueType: 'REFUND_FAILED' as const,
    severity: 'CRITICAL' as const,
    source: input.source,
    actorRole: 'SYSTEM',
    orderId: input.orderId,
    provider: input.provider,
    relatedEntityType: 'order_payment',
    relatedEntityId: input.paymentId,
    stage: 'REFUND_FAILURE_LEDGER',
    title: 'Failed refund needs ledger review',
    description: 'The provider reported a previously confirmed refund as failed, but its payment and ledger could not be reconciled safely.',
    recommendedAction: 'Compare provider failure and journal evidence, then use a reviewed recovery. Do not retry the refund or edit money state directly.',
    dedupeKey: `refund-failure-ledger-blocked:${input.provider.toLowerCase()}:${input.refundId}`,
    queueKey: 'money-desk' as const,
    persistWhenRoutineDisabled: true,
    skipIfUnchanged: true,
    metadata: { payment_id: input.paymentId, provider_refund_id: input.refundId },
  }
}

/** Save a critical Ops case before rethrowing the RPC error so webhook retries
 * cannot leave a failed refund invisible when the journal is incomplete. */
export async function reconcileFailedRefundOrAlert<E>(
  reconcile: () => Promise<{ error: E | null }>,
  openCriticalCase: () => Promise<boolean>,
): Promise<void> {
  let failure: unknown
  try {
    failure = (await reconcile()).error
  } catch (error) {
    failure = error
  }
  if (!failure) return
  if (!await openCriticalCase()) throw new Error('REFUND_FAILURE_LEDGER_CASE_NOT_SAVED')
  throw failure
}
