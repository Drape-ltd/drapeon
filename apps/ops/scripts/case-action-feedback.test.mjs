import { test } from 'node:test'
import assert from 'node:assert/strict'
import { caseActionFailure, caseActionSuccess, caseActionReference } from '../lib/case-action-feedback.mjs'

test('failure copy preserves input and gives status-specific recovery', () => {
  for (const status of [400, 401, 403, 409, 413, 429, 500, 502]) assert.match(caseActionFailure(status), /input is preserved/)
  assert.match(caseActionFailure(409), /latest state/)
  assert.match(caseActionFailure(401), /Sign in again/)
  assert.match(caseActionFailure(403), /authorized operator/)
  assert.match(caseActionFailure(500), /retry unchanged/)
})

test('success describes the actual action without claiming side-effect delivery', () => {
  assert.match(caseActionSuccess('RESOLVE_DEAD_JOB'), /not retried/)
  assert.match(caseActionSuccess('ESCALATE'), /does not confirm notification delivery/)
  assert.match(caseActionSuccess('ADD_NOTE'), /No customer notification/)
  assert.match(caseActionSuccess('ASSIGN_SELF'), /assigned to you/)
})

test('successful receipt reference matches history, including duplicate recovery', () => {
  assert.equal(caseActionReference({ correlationId: 'request-new', receipt: { receiptOutcome: 'SUCCEEDED', correlationId: 'persisted-original' } }), 'persisted-original')
  assert.equal(caseActionReference({ correlationId: 'failed-request' }), 'failed-request')
  assert.equal(caseActionReference(null), undefined)
})
