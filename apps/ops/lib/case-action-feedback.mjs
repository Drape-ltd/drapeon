// Keep database/broker codes out of operator-facing copy. No response body or
// private provider detail is echoed; the correlation ID remains available.
export function caseActionFailure(status) {
  if (status === 409) return 'This case changed or was finished by another operator. Your input is preserved. Refresh the case and review its latest state before trying again.'
  if (status === 401) return 'Your workforce session needs to be renewed. Your input is preserved. Sign in again, then retry the same action.'
  if (status === 403) return 'Your current role or access level cannot perform this action. Your input is preserved. Ask an authorized operator to review the case.'
  if (status === 400 || status === 413) return 'The action could not be accepted. Your input is preserved. Check the required fields and text limits before trying again.'
  if (status === 429) return 'Too many requests were sent. Your input is preserved. Wait briefly, then retry the same action.'
  return 'The action could not be confirmed. Your input is preserved. Refresh to check whether it was recorded; if needed, retry unchanged to avoid a duplicate.'
}

export function caseActionSuccess(action) {
  return {
    ACKNOWLEDGE: 'Case acknowledged. The action is recorded in its history.',
    ASSIGN_SELF: 'This case is now assigned to you.',
    ADD_NOTE: 'Internal note saved. No customer notification was sent.',
    ESCALATE: 'Escalation recorded for the backup team. This does not confirm notification delivery.',
    RESOLVE_DEAD_JOB: 'No-replay review recorded. The job was not retried; its history is retained.',
  }[action] ?? 'The action was recorded in the case history.'
}

export function caseActionReference(payload) {
  const receipt = payload?.receipt
  // An idempotent retry may return an earlier receipt. Its reference, not the
  // current HTTP request reference, is the one operators find in case history.
  if (receipt?.receiptOutcome === 'SUCCEEDED' && typeof receipt.correlationId === 'string') return receipt.correlationId
  return typeof payload?.correlationId === 'string' ? payload.correlationId : undefined
}
