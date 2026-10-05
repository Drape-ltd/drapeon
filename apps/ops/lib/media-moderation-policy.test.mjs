import test from 'node:test'
import assert from 'node:assert/strict'
import { linkedMediaComplete, mediaDecisionTransition, mediaFollowUpFailures } from './media-moderation-policy.mjs'

test('same media decision reconciles follow-ups instead of returning early', () => {
  assert.equal(mediaDecisionTransition('APPROVED', 'APPROVED'), 'RECONCILE')
  assert.equal(mediaDecisionTransition('BLOCKED', 'BLOCKED'), 'RECONCILE')
  assert.equal(mediaDecisionTransition('PENDING_REVIEW', 'APPROVED'), 'APPLY')
  assert.equal(mediaDecisionTransition('BLOCKED', 'APPROVED'), 'CONFLICT')
})

test('incomplete linked media cannot close a case', () => {
  assert.equal(linkedMediaComplete(['a', 'b'], [{ id: 'a' }]), false)
  assert.equal(linkedMediaComplete(['a', 'b'], [{ id: 'b' }, { id: 'a' }]), true)
  assert.equal(linkedMediaComplete(['a'], null), false)
})

test('every failed follow-up is named in the partial outcome', () => {
  assert.deepEqual(mediaFollowUpFailures({ report: true, case: true, audit: true, ownerNotification: true }),
    ['report', 'case', 'audit', 'owner notification'])
  assert.deepEqual(mediaFollowUpFailures({ report: false, case: false, audit: false, ownerNotification: false }), [])
})
