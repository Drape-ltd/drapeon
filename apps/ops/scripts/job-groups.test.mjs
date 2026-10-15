import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupJobsByType } from '../lib/job-groups.mjs'

test('groups recorded types without mixing actions or inferring root cause', () => {
  assert.deepEqual(groupJobsByType([
    { type: 'EMAIL', status: 'DEAD', linkedCaseNumber: null, payload: 'private' },
    { type: 'PAYOUT', status: 'DEAD', linkedCaseNumber: 'OPS-123' },
    { type: 'EMAIL', status: 'PENDING', linkedCaseNumber: null },
    { type: 'EMAIL', status: 'DEAD', linkedCaseNumber: 'OPS-456' },
  ]), [
    { type: 'EMAIL', count: 3, missingCases: 1 },
    { type: 'PAYOUT', count: 1, missingCases: 0 },
  ])
})

test('empty source has no manufactured groups', () => {
  assert.deepEqual(groupJobsByType([]), [])
})
