import assert from 'node:assert/strict'
import test from 'node:test'
import {
  planCancellationRefundRequest,
  type CancellationRefundAttempt,
  type CancellationRefundRequest,
} from '../lib/cancellation-refund-recovery.ts'

const baseKey = 'order-cancellation-refund:order-1:review-1:payment-1:0:13531'
const safeAttempt: CancellationRefundAttempt = {
  status: 'FAILED',
  failure_code: 'EXECUTION_ADAPTER_BLOCKED',
  failure_summary: 'This refund action requires a trusted service request.',
  provider_reference: null,
}
const failedRequest: CancellationRefundRequest = {
  id: 'failed-request-1',
  idempotency_key: baseKey,
  status: 'FAILED',
  execution_outcome: 'FAILED',
  provider_reference: null,
  amount: 13531,
  currency: 'USD',
  action_payload: { paymentSnapshotKey: 'payment-1:0:13531' },
}
const input = {
  baseKey,
  snapshotKey: 'payment-1:0:13531',
  amount: 13531,
  currency: 'USD',
  requests: [failedRequest],
  latestAttempts: [safeAttempt],
  hasRefundClaim: false,
  hasRefundResolution: false,
}

test('first preparation keeps its stable idempotency key', () => {
  assert.deepEqual(planCancellationRefundRequest({ ...input, requests: [], latestAttempts: [] }), {
    kind: 'SUBMIT', idempotencyKey: baseKey, recoveryOfRequestId: null,
  })
})

test('the known pre-provider guard failure creates one distinct reviewed recovery key', () => {
  assert.deepEqual(planCancellationRefundRequest(input), {
    kind: 'SUBMIT',
    idempotencyKey: `${baseKey}:recovery:${failedRequest.id}`,
    recoveryOfRequestId: failedRequest.id,
  })
  const replacement: CancellationRefundRequest = {
    ...failedRequest,
    id: 'replacement-request-2',
    idempotency_key: `${baseKey}:recovery:${failedRequest.id}`,
    status: 'PENDING_APPROVAL',
    execution_outcome: null,
  }
  assert.deepEqual(planCancellationRefundRequest({
    ...input, requests: [replacement, failedRequest], latestAttempts: [],
  }), { kind: 'EXISTING', requestId: replacement.id })
})

test('provider ambiguity and any refund evidence block a replacement', () => {
  const blocked = [
    { latestAttempts: [{ ...safeAttempt, failure_summary: 'Stripe timed out.' }] },
    { latestAttempts: [{ ...safeAttempt, provider_reference: 're_123' }] },
    { latestAttempts: [{ ...safeAttempt }, { ...safeAttempt }] },
    { requests: [{ ...failedRequest, provider_reference: 're_123' }] },
    { hasRefundClaim: true },
    { hasRefundResolution: true },
  ]
  for (const override of blocked) {
    assert.deepEqual(planCancellationRefundRequest({ ...input, ...override }), { kind: 'BLOCKED' })
  }
  assert.deepEqual(planCancellationRefundRequest({
    ...input, requests: [], latestAttempts: [], hasRefundClaim: true,
  }), { kind: 'BLOCKED' })
})

test('a changed snapshot, another live request, and a succeeded request fail closed', () => {
  assert.deepEqual(planCancellationRefundRequest({
    ...input, requests: [{ ...failedRequest, amount: 14000 }],
  }), { kind: 'BLOCKED' })
  assert.deepEqual(planCancellationRefundRequest({
    ...input, requests: [
      { ...failedRequest, id: 'other', idempotency_key: 'other-snapshot', status: 'APPROVED' },
      failedRequest,
    ],
  }), { kind: 'BLOCKED' })
  assert.deepEqual(planCancellationRefundRequest({
    ...input, requests: [{ ...failedRequest, status: 'SUCCEEDED' }],
  }), { kind: 'BLOCKED' })
})
