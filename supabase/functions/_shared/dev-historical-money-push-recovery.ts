export type HistoricalCase = {
  id: string
  source: string
  relatedEntityId: string
  issueNumber: number
  orderId: string | null
}

export type HistoricalNotice = {
  caseId: string
  providerReference: string | null
}

export type HistoricalRecoveryPort = {
  targetIds(): Promise<string[]>
  cases(ids: string[]): Promise<HistoricalCase[]>
  createMissingCases(ids: string[]): Promise<void>
  acceptedNotices(caseIds: string[]): Promise<string[]>
  sendNotice(issue: HistoricalCase): Promise<{ ok: boolean; providerReference: string | null }>
  recordNotice(notice: HistoricalNotice): Promise<void>
}

export const HISTORICAL_MONEY_PUSH_SOURCE = 'historical-money-push-reconciliation'
export const HISTORICAL_MONEY_PUSH_COUNT = 7
export const HISTORICAL_MONEY_PUSH_JOB_SET_HASH =
  'dbab68bfbc424db4b223ef36b6f42a15a23ae445ce5e417ce238beac3d20d3ab'

export async function sha256SortedIds(ids: string[]): Promise<string> {
  const bytes = new TextEncoder().encode([...ids].sort().join(','))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function assertCases(cases: HistoricalCase[], ids: string[], expectedCount: number) {
  if (cases.length !== expectedCount) throw new Error(`HISTORICAL_CASE_COUNT:${cases.length}`)
  const seen = new Set<string>()
  for (const issue of cases) {
    if (
      issue.source !== HISTORICAL_MONEY_PUSH_SOURCE ||
      !ids.includes(issue.relatedEntityId) ||
      seen.has(issue.relatedEntityId)
    ) throw new Error('HISTORICAL_CASE_MISMATCH')
    seen.add(issue.relatedEntityId)
  }
}

/** One reviewed Dev run. Existing cases are never recreated, and accepted
 * notice audit rows make ordinary replay a no-op. Provider email sends also
 * use a stable idempotency key for an ambiguous response within 24 hours. */
export async function reconcileDevHistoricalMoneyPushes(
  port: HistoricalRecoveryPort,
  expectedHash = HISTORICAL_MONEY_PUSH_JOB_SET_HASH,
) {
  const ids = [...new Set(await port.targetIds())].sort()
  if (ids.length !== HISTORICAL_MONEY_PUSH_COUNT || await sha256SortedIds(ids) !== expectedHash) {
    throw new Error('HISTORICAL_JOB_SET_CHANGED')
  }
  const before = await port.cases(ids)
  // The local approved run saved exactly one case before its notice step
  // stopped. A full replay has seven cases. Anything else needs review.
  if (before.length !== 1 && before.length !== HISTORICAL_MONEY_PUSH_COUNT) {
    throw new Error(`HISTORICAL_PARTIAL_STATE_CHANGED:${before.length}`)
  }
  assertCases(before, ids, before.length)
  if (before.length === 1) await port.createMissingCases(ids)
  const after = await port.cases(ids)
  assertCases(after, ids, HISTORICAL_MONEY_PUSH_COUNT)

  const acceptedRows = await port.acceptedNotices(after.map((issue) => issue.id))
  const accepted = new Set(acceptedRows)
  if (acceptedRows.length !== accepted.size) throw new Error('HISTORICAL_DUPLICATE_NOTICE_AUDIT')
  if ([...accepted].some((id) => !after.some((issue) => issue.id === id))) {
    throw new Error('HISTORICAL_NOTICE_AUDIT_MISMATCH')
  }
  let sent = 0
  for (const issue of after.sort((a, b) => a.relatedEntityId.localeCompare(b.relatedEntityId))) {
    if (accepted.has(issue.id)) continue
    const result = await port.sendNotice(issue)
    if (!result.ok) throw new Error('HISTORICAL_OPS_NOTICE_FAILED')
    await port.recordNotice({ caseId: issue.id, providerReference: result.providerReference })
    sent += 1
  }
  return { targetCount: ids.length, casesCreated: after.length - before.length, noticesAccepted: sent }
}
