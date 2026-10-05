// @ts-check

/** @typedef {{ id: string, actionTaken: string, performedBy: string | null, performedRole: string | null, reason: string | null, createdAt: string }} CaseHistoryEntry */

const SLA_REMINDER_ACTION = 'SLA_REMINDER_DUE'
const SLA_REMINDER_GROUP_THRESHOLD = 4

/**
 * @param {readonly CaseHistoryEntry[]} history
 * @param {number} [visibleLimit]
 */
export function partitionCaseHistory(history, visibleLimit = 100) {
  const reminders = history.filter((entry) => entry.actionTaken === SLA_REMINDER_ACTION)
  const shouldGroupReminders = reminders.length > SLA_REMINDER_GROUP_THRESHOLD
  const timeline = shouldGroupReminders
    ? history.filter((entry) => entry.actionTaken !== SLA_REMINDER_ACTION)
    : [...history]

  return {
    visible: timeline.slice(0, visibleLimit),
    groupedSlaReminders: shouldGroupReminders ? reminders : [],
  }
}
