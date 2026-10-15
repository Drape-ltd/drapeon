import test from 'node:test'
import assert from 'node:assert/strict'
import { isJobRecoveryCase, jobCaseGuidance, jobCaseSummary } from '../lib/job-case-guidance.mjs'

const job = { queueKey: 'reliability', relatedEntityType: 'job_queue', status: 'NEW', recommendedAction: 'Retry manually', summary: 'Provider response details' }
test('job guidance distinguishes case closure from workflow recovery', () => {
  assert.match(jobCaseGuidance(job), /job-specific recovery/)
  assert.match(jobCaseGuidance(job), /does not retry/)
  assert.doesNotMatch(jobCaseGuidance(job), /Retry manually/)
  assert.doesNotMatch(jobCaseSummary(job), /Provider response/)
  assert.equal(job.summary, 'Provider response details')
  for (const status of ['RESOLVED', 'CLOSED', 'CANCELLED']) assert.match(jobCaseGuidance({ ...job, status }), /does not mean the job ran successfully/)
})
test('unrelated domain instructions remain unchanged', () => {
  for (const record of [{ ...job, queueKey: 'money' }, { ...job, relatedEntityType: 'orders' }]) {
    assert.equal(isJobRecoveryCase(record), false)
    assert.equal(jobCaseGuidance(record), record.recommendedAction)
    assert.equal(jobCaseSummary(record), record.summary)
  }
})
test('grouped failure summary includes the durable affected count', () => {
  const group = { ...job, relatedEntityType: 'job_failure_group', metadata: { affectedJobCount: 12 } }
  assert.equal(isJobRecoveryCase(group), true)
  assert.match(jobCaseSummary(group), /12 failed background tasks/)
  assert.match(jobCaseSummary(group), /closure does not complete/)
  assert.match(jobCaseSummary({ ...group, metadata: { affectedJobCount: -1 } }), /Related background tasks/)
})
