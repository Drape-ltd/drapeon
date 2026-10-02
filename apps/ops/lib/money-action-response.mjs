/** A 2xx transport response is not an authoritative Money Desk result. */
function resultRecord(payload, status) {
  if (status !== 200 || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const body = /** @type {Record<string, unknown>} */ (payload)
  if (body.ok !== true || !body.result || typeof body.result !== 'object' || Array.isArray(body.result)) return null
  return /** @type {Record<string, unknown>} */ (body.result)
}

/** @param {unknown} payload @param {number} status */
export function confirmedMoneyElevation(payload, status) {
  const result = resultRecord(payload, status)
  if (!result || typeof result.grantId !== 'string' || !result.grantId.trim()
    || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) return null
  return { grantId: result.grantId, expiresAt: result.expiresAt }
}

/** @param {unknown} payload @param {number} status @param {string} requestId @param {'APPROVE' | 'REJECT'} decision */
export function confirmedMoneyDecision(payload, status, requestId, decision) {
  const result = resultRecord(payload, status)
  if (!result || result.requestId !== requestId) return null
  if (decision === 'REJECT' && result.status === 'REJECTED') return { state: 'REJECTED' }
  if (decision === 'APPROVE' && (result.status === 'APPROVED' || result.status === 'PENDING_APPROVAL')) {
    return { state: result.status }
  }
  return null
}

/** @param {unknown} payload @param {number} status */
export function confirmedMoneyPreparation(payload, status) {
  const result = resultRecord(payload, status)
  if (!result || typeof result.requestId !== 'string' || !result.requestId.trim()) return null
  const allowed = ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'REJECTED', 'FAILED']
  if (typeof result.status !== 'string' || !allowed.includes(result.status)) return null
  return { requestId: result.requestId, state: result.status }
}
