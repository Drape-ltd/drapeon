import test from 'node:test'
import assert from 'node:assert/strict'
import { isReviewedDeadJob } from './job-review-state.mjs'
test('closure alone is not a no-replay disposition', () => {
  const job = { status: 'DEAD', linkedCaseStatus: 'RESOLVED' }
  assert.equal(isReviewedDeadJob(job), false)
  assert.equal(isReviewedDeadJob({ ...job, linkedCaseDisposition: 'ACKNOWLEDGED_NO_REPLAY' }), true)
  assert.equal(isReviewedDeadJob({ ...job, linkedCaseStatus: 'NEW', linkedCaseDisposition: 'ACKNOWLEDGED_NO_REPLAY' }), false)
  assert.equal(isReviewedDeadJob({ ...job, status: 'PROCESSING', linkedCaseDisposition: 'RECOVERED' }), false)
})
