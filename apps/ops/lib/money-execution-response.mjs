/**
 * HTTP success alone cannot prove a provider command was recorded. An unclear
 * response must keep the idempotency key available for authoritative recovery.
 * @param {unknown} payload
 * @param {number} status
 * @returns {{ state: 'PROCESSING' | 'SUCCEEDED', attemptId: string } | null}
 */
export function confirmedMoneyExecution(payload, status) {
  if (status !== 200 && status !== 202) return null
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const body = /** @type {Record<string, unknown>} */ (payload)
  if (body.ok !== true || !body.result || typeof body.result !== 'object' || Array.isArray(body.result)) return null
  const result = /** @type {Record<string, unknown>} */ (body.result)
  if (result.ok !== true || typeof result.attemptId !== 'string' || !result.attemptId.trim()) return null
  if (result.state === 'PROCESSING' && result.pending === true && status === 202) {
    return { state: 'PROCESSING', attemptId: result.attemptId }
  }
  if (result.state === 'SUCCEEDED' && result.pending !== true && status === 200) {
    return { state: 'SUCCEEDED', attemptId: result.attemptId }
  }
  return null
}
