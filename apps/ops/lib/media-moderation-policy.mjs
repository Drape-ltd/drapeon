const TERMINAL_MEDIA_STATUSES = new Set(['APPROVED', 'AUTO_ALLOWED', 'BLOCKED'])

/** @param {string} current @param {string} desired */
export function mediaDecisionTransition(current, desired) {
  if (current === desired) return 'RECONCILE'
  if (TERMINAL_MEDIA_STATUSES.has(current)) return 'CONFLICT'
  return 'APPLY'
}

/** @param {string[]} expectedIds @param {{ id: string }[] | null} rows */
export function linkedMediaComplete(expectedIds, rows) {
  if (!rows) return false
  const found = new Set(rows.map((row) => row.id))
  return expectedIds.every((id) => found.has(id))
}

/** @param {{ report: boolean; case: boolean; audit: boolean; ownerNotification: boolean }} failures */
export function mediaFollowUpFailures(failures) {
  return [
    failures.report ? 'report' : null,
    failures.case ? 'case' : null,
    failures.audit ? 'audit' : null,
    failures.ownerNotification ? 'owner notification' : null,
  ].filter(Boolean)
}
