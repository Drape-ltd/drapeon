import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partitionCaseHistory } from '../lib/case-history.mjs'

const note = { id: 'event', source: 'event', actionTaken: 'INTERNAL_NOTE', performedBy: 'operator', performedRole: null, reason: 'Review evidence', createdAt: '2026-10-15T12:00:00.123456Z' }
const audit = { ...note, id: 'audit', source: 'audit', actionTaken: 'CASE_ADD_NOTE', performedRole: 'support' }

test('one note is shown with its intact matching audit available', () => {
  const history = [audit, note]
  const result = partitionCaseHistory(history)
  assert.deepEqual(result.visible, [note])
  assert.equal(result.noteAudits.get(note.id), audit)
  assert.equal(history.length, 2)
})

test('distinct or legacy evidence is never hidden', () => {
  for (const change of [{ createdAt: '2026-10-15T12:00:00.123457Z' }, { performedBy: 'another' }, { reason: 'Different' }, { source: undefined }, { actionTaken: 'CASE_ACKNOWLEDGE' }]) {
    const result = partitionCaseHistory([{ ...audit, ...change }, note])
    assert.equal(result.visible.length, 2)
    assert.equal(result.noteAudits.size, 0)
  }
})

test('identical notes pair one to one rather than losing repeated saves', () => {
  const result = partitionCaseHistory([audit, { ...audit, id: 'audit2' }, note, { ...note, id: 'event2' }])
  assert.equal(result.visible.length, 2)
  assert.equal(result.noteAudits.size, 2)
  assert.notEqual(result.noteAudits.get('event').id, result.noteAudits.get('event2').id)
})

test('SLA grouping and visible limits still preserve underlying evidence', () => {
  const reminders = Array.from({ length: 5 }, (_, index) => ({ ...audit, id: `reminder${index}`, actionTaken: 'SLA_REMINDER_DUE' }))
  const result = partitionCaseHistory([...reminders, audit, note], 1)
  assert.deepEqual(result.visible, [note])
  assert.deepEqual(result.groupedSlaReminders, reminders)
  assert.equal(result.noteAudits.size, 1)
})
