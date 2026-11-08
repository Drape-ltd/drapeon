export type CancellationRefundRequest = {
  id: string
  idempotency_key: string
  status: string
  execution_outcome: string | null
  provider_reference: string | null
  amount: number | null
  currency: string | null
  action_payload: Record<string, unknown> | null
}

export type CancellationRefundAttempt = {
  status: string
  failure_code: string | null
  failure_summary: string | null
  provider_reference: string | null
}

type PlanInput = {
  baseKey: string
  snapshotKey: string
  amount: number
  currency: string
  requests: CancellationRefundRequest[] // Newest first.
  latestAttempts: CancellationRefundAttempt[]
  hasRefundClaim: boolean
  hasRefundResolution: boolean
}

export type CancellationRefundPlan =
  | { kind: 'SUBMIT'; idempotencyKey: string; recoveryOfRequestId: string | null }
  | { kind: 'EXISTING'; requestId: string }
  | { kind: 'BLOCKED' }

/**
 * An old failed request can be replaced only when its one execution was
 * rejected by the refund Edge authentication guard, before any provider call.
 * The generic EXECUTION_ADAPTER_BLOCKED code also covers provider failures,
 * so its code alone is never sufficient evidence.
 */
export function planCancellationRefundRequest(input: PlanInput): CancellationRefundPlan {
  if (input.hasRefundClaim || input.hasRefundResolution) return { kind: 'BLOCKED' }
  const sameSnapshot = (request: CancellationRefundRequest) =>
    request.idempotency_key === input.baseKey ||
    request.idempotency_key.startsWith(`${input.baseKey}:recovery:`)
  const current = input.requests.find(sameSnapshot)

  // A live or successful request for the order must never compete with a new one.
  if (input.requests.some((request) =>
    !sameSnapshot(request) &&
    !['FAILED', 'REJECTED', 'CANCELLED'].includes(request.status)
  )) return { kind: 'BLOCKED' }

  if (!current) {
    // An unrelated failed request needs an operator/provider reconciliation;
    // a changed payment snapshot is not evidence that its provider call failed.
    if (input.requests.some((request) => request.status === 'FAILED')) {
      return { kind: 'BLOCKED' }
    }
    return { kind: 'SUBMIT', idempotencyKey: input.baseKey, recoveryOfRequestId: null }
  }

  if (
    current.amount !== input.amount ||
    current.currency !== input.currency ||
    current.action_payload?.paymentSnapshotKey !== input.snapshotKey
  ) return { kind: 'BLOCKED' }

  if (['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'].includes(current.status)) {
    return { kind: 'EXISTING', requestId: current.id }
  }
  if (current.status !== 'FAILED' || current.execution_outcome !== 'FAILED') {
    return { kind: 'BLOCKED' }
  }

  const attempt = input.latestAttempts[0]
  if (
    input.latestAttempts.length !== 1 ||
    attempt?.status !== 'FAILED' ||
    attempt.failure_code !== 'EXECUTION_ADAPTER_BLOCKED' ||
    attempt.failure_summary !== 'This refund action requires a trusted service request.' ||
    attempt.provider_reference != null ||
    current.provider_reference != null ||
    input.hasRefundClaim ||
    input.hasRefundResolution
  ) return { kind: 'BLOCKED' }

  return {
    kind: 'SUBMIT',
    idempotencyKey: `${input.baseKey}:recovery:${current.id}`,
    recoveryOfRequestId: current.id,
  }
}
