// @ts-check

/** @typedef {{ id: string, actionTaken: string, performedBy: string | null, performedRole: string | null, reason: string | null, createdAt: string, source?: 'audit' | 'event' }} CaseHistoryEntry */

const SLA_REMINDER_ACTION = 'SLA_REMINDER_DUE'
const SLA_REMINDER_GROUP_THRESHOLD = 4

/**
 * @param {readonly CaseHistoryEntry[]} history
 * @param {number} [visibleLimit]
 */
export function partitionCaseHistory(history, visibleLimit = 100) {
  // Pair only the exact note mirrors emitted together by case collaboration.
  // Never collapse repeated notes, different actors, or approximate timestamps.
  const pairedAuditIds = new Set()
  const noteAudits = new Map()
  for (const event of history) {
    if (event.source !== 'event' || event.actionTaken !== 'INTERNAL_NOTE' || !event.performedBy || !event.reason) continue
    const audit = history.find((entry) => entry.source === 'audit' && entry.actionTaken === 'CASE_ADD_NOTE'
      && !pairedAuditIds.has(entry.id) && entry.createdAt === event.createdAt
      && entry.performedBy === event.performedBy && entry.reason === event.reason)
    if (audit) {
      pairedAuditIds.add(audit.id)
      noteAudits.set(event.id, audit)
    }
  }
  const reminders = history.filter((entry) => entry.actionTaken === SLA_REMINDER_ACTION)
  const shouldGroupReminders = reminders.length > SLA_REMINDER_GROUP_THRESHOLD
  const timeline = shouldGroupReminders
    ? history.filter((entry) => entry.actionTaken !== SLA_REMINDER_ACTION)
    : [...history]

  return {
    visible: timeline.filter((entry) => !pairedAuditIds.has(entry.id)).slice(0, visibleLimit),
    noteAudits,
    groupedSlaReminders: shouldGroupReminders ? reminders : [],
  }
}
