import assert from 'node:assert/strict'
import test from 'node:test'

import { hasOpenOrderReview } from './order-review-ownership.mjs'

test('an unrelated open push alert does not own a customer dispute', () => {
  assert.equal(hasOpenOrderReview([{ type: 'SYSTEM_ALERT', status: 'ESCALATED' }]), false)
})

test('an open order review owns the dispute even with unrelated alerts', () => {
  assert.equal(hasOpenOrderReview([
    { type: 'SYSTEM_ALERT', status: 'ESCALATED' },
    { type: 'ORDER_REVIEW', status: 'IN_REVIEW' },
  ]), true)
})

test('a closed order review no longer owns the dispute', () => {
  assert.equal(hasOpenOrderReview([{ type: 'ORDER_REVIEW', status: 'RESOLVED' }]), false)
})
