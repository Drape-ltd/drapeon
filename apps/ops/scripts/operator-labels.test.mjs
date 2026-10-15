import test from 'node:test'
import assert from 'node:assert/strict'
import { operatorLabel } from '../lib/operator-labels.mjs'

test('legacy verification names describe challenge-video trust review, not identity-document KYC', () => {
  assert.equal(operatorLabel('identity_verification_handoff'), 'Challenge video review')
  assert.equal(operatorLabel('TAILOR_VERIFICATION'), 'Tailor trust review')
})

test('routine activity and internal record types use operator language', () => {
  assert.equal(operatorLabel('SLA_REMINDER_DUE'), 'Response reminder')
  assert.equal(operatorLabel('CASE_ADD_NOTE'), 'Note saved')
  assert.equal(operatorLabel('job_queue'), 'Background task')
  assert.equal(operatorLabel('profile_change_request'), 'Profile changes')
})

test('unmapped statuses keep their readable label instead of disappearing', () => {
  assert.equal(operatorLabel('WAITING_PROVIDER'), 'Waiting Provider')
  assert.equal(operatorLabel(''), '')
})
