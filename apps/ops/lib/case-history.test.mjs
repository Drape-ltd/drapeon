import assert from 'node:assert/strict'
import test from 'node:test'
import { partitionCaseHistory } from './case-history.mjs'

const event = (id, actionTaken) => ({
  id,
  actionTaken,
  performedBy: 'System',
  performedRole: 'SYSTEM',
  reason: actionTaken === 'SLA_REMINDER_DUE' ? 'This case still needs an operator outcome.' : null,
  createdAt: '2026-10-02T12:00:00.000Z',
})

test('repeated SLA reminders are grouped while every event remains available', () => {
  const history = [
    event('important-new', 'CASE_ACKNOWLEDGED'),
    ...Array.from({ length: 352 }, (_, index) => event(`reminder-${index}`, 'SLA_REMINDER_DUE')),
    event('old-note', 'CASE_NOTE_ADDED'),
  ]
  const result = partitionCaseHistory(history)
  assert.equal(result.groupedSlaReminders.length, 352)
  assert.deepEqual(result.visible.map((item) => item.id), ['important-new', 'old-note'])
})

test('small reminder counts remain inline and the normal history limit still applies', () => {
  const history = [event('new', 'CASE_ACKNOWLEDGED'), ...Array.from({ length: 4 }, (_, index) => event(`reminder-${index}`, 'SLA_REMINDER_DUE'))]
  const result = partitionCaseHistory(history, 3)
  assert.equal(result.groupedSlaReminders.length, 0)
  assert.equal(result.visible.length, 3)
})
