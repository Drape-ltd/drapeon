import assert from 'node:assert/strict'
import test from 'node:test'
import { isFirstReleaseReady, resolveStripeReviewPresentation } from './payout-review-state.ts'

test('first-release review has its own blocked-paid-orders presentation', () => {
  assert.equal(
    resolveStripeReviewPresentation({ firstReleaseReviewPending: true, pendingReview: false }),
    'FIRST_RELEASE'
  )
})

test('replacement review preserves the existing active-account presentation', () => {
  assert.equal(
    resolveStripeReviewPresentation({ firstReleaseReviewPending: false, pendingReview: true }),
    'REPLACEMENT'
  )
})

test('first-release state wins if an older response contains both flags', () => {
  assert.equal(
    resolveStripeReviewPresentation({ firstReleaseReviewPending: true, pendingReview: true }),
    'FIRST_RELEASE'
  )
})

test('persisted first-release status keeps paid work closed until clearance', () => {
  assert.equal(isFirstReleaseReady('PENDING'), false)
  assert.equal(isFirstReleaseReady('BLOCKED'), false)
  assert.equal(isFirstReleaseReady('CLEARED'), true)
})
