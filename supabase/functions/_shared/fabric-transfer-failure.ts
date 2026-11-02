import { classifyStripeTransferFailure } from './stripe-transfer-safety.ts'

export type FabricTransferFailureRecord = {
  outcome: 'FAILED' | 'AMBIGUOUS'
  code: string
  httpStatus: number | null
  requestId: string | null
  message: string
  attemptNumber: number
}

export async function handleFabricStripeTransferFailure(
  error: unknown,
  attemptNumber: number,
  deps: {
    recordOutcome: (record: FabricTransferFailureRecord) => Promise<void>
    updatePayout: (record: FabricTransferFailureRecord) => Promise<void>
    advanceAttempt: (nextAttempt: number) => Promise<void>
    persistOpsIssue: (record: FabricTransferFailureRecord) => Promise<boolean>
    notify: (record: FabricTransferFailureRecord) => Promise<void>
  },
) {
  const classified = classifyStripeTransferFailure(error)
  const record: FabricTransferFailureRecord = {
    outcome: classified.outcome === 'DEFINITE' ? 'FAILED' : 'AMBIGUOUS',
    code: classified.code,
    httpStatus: classified.status,
    requestId: classified.requestId,
    message: error instanceof Error ? error.message : String(error),
    attemptNumber,
  }
  await deps.recordOutcome(record)
  await deps.updatePayout(record)
  if (record.outcome === 'FAILED') await deps.advanceAttempt(attemptNumber + 1)
  const persisted = await deps.persistOpsIssue(record)
  if (!persisted) throw new Error('FABRIC_OPS_CASE_PERSISTENCE_FAILED')
  await deps.notify(record)
  return record
}
