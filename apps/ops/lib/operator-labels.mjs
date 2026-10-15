// @ts-check
/** @type {Record<string, string>} */
const labels = {
  IDENTITY_VERIFICATION_HANDOFF: 'Challenge video review',
  TAILOR_VERIFICATION: 'Tailor trust review',
  PROFILE_CHANGE_REQUEST: 'Profile changes',
  JOB_QUEUE: 'Background task',
  JOB_FAILURE_GROUP: 'Related task failures',
  SLA_REMINDER_DUE: 'Response reminder',
  CASE_ADD_NOTE: 'Note saved',
  CASE_ASSIGN_SELF: 'Ownership accepted',
  CASE_ACKNOWLEDGE: 'Case acknowledged',
}

/** @param {string} value */
export function operatorLabel(value) {
  return labels[value.toUpperCase()] ?? value.toLowerCase().replace(/[_-]+/g, ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}
