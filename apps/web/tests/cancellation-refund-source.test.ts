import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCancellationRefundSource } from '../lib/cancellation-refund-source.ts'

const review = { status: 'OPEN', requestedAt: '2026-11-07T19:20:32.628Z' }
const issue = {
  id: 'bfafd1d7-1918-4945-a183-18baba113d57',
  issue_type: 'ORDER_REVIEW',
  status: 'OPEN',
  metadata: { review_type: 'CANCELLATION' },
}

test('a customer cancellation review is valid refund preparation evidence', () => {
  assert.deepEqual(resolveCancellationRefundSource({ review, issue }), {
    kind: 'REVIEW',
    reviewRequestedAt: review.requestedAt,
    reviewIssueId: issue.id,
  })
})

test('a prior dispute keeps its existing refund path', () => {
  assert.deepEqual(resolveCancellationRefundSource({ disputeId: 'dispute-1', review, issue }), {
    kind: 'DISPUTE', disputeId: 'dispute-1',
  })
})

test('review evidence fails closed when the review or case is stale or mismatched', () => {
  assert.throws(() => resolveCancellationRefundSource({ review: { ...review, status: 'RESOLVED' }, issue }))
  assert.throws(() => resolveCancellationRefundSource({ review, issue: { ...issue, status: 'RESOLVED' } }))
  assert.throws(() => resolveCancellationRefundSource({ review, issue: { ...issue, metadata: { review_type: 'DELIVERY' } } }))
  assert.throws(() => resolveCancellationRefundSource({ review, issue: null }))
})
